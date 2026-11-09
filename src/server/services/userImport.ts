import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { studentCsvRowSchema, teacherCsvRowSchema, GUARDIAN_RELATIONSHIP_VALUES } from '@/lib/validators/users';
import { linkParentToStudentTx } from '@/server/services/userLinks';
import { sendInvite } from '@/server/services/users';

/**
 * Server-side import batch transaction (component 9, FR-18, FR-20..FR-23,
 * NFR-3). Never trusts the client: every row is re-validated here against
 * the same Zod schemas the create form uses (src/lib/validators/users.ts).
 *
 * Batching contract: rows are processed in chunks of 200. Each batch is
 * validated first (read-only, no writes) so an existing-email row can be
 * classified "skipped" without touching the DB; if any row in the batch is
 * a genuine error (bad data, unknown grade level), the whole batch is
 * rolled back / never written (NFR-3's all-or-rollback), and every row in
 * that batch — including ones that would otherwise have succeeded — is
 * reported as 'error' so the summary never claims a write that didn't
 * happen. Other batches are unaffected.
 */

export type ImportType = 'STUDENTS' | 'TEACHERS';

export interface ImportRowResult {
  rowIndex: number;
  result: 'created' | 'skipped' | 'error';
  reason: string | null;
}

export interface ImportSummary {
  createdStudents: number;
  createdParents: number;
  linkedExistingParents: number;
  skipped: number;
  failed: number;
  rowResults: ImportRowResult[];
}

const BATCH_SIZE = 200;

type TxClient = Prisma.TransactionClient;
type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIP_VALUES)[number];

interface ParsedParent {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  relationship: GuardianRelationship;
}

function parentRelationship(value: string | undefined): GuardianRelationship {
  const upper = (value ?? '').toUpperCase();
  return (GUARDIAN_RELATIONSHIP_VALUES as readonly string[]).includes(upper)
    ? (upper as GuardianRelationship)
    : 'OTHER';
}

async function findGradeLevel(client: TxClient | typeof prisma, name: string) {
  return client.gradeLevel.findFirst({
    where: {
      OR: [{ name: { equals: name, mode: 'insensitive' } }, { shortName: { equals: name, mode: 'insensitive' } }],
    },
  });
}

type PlannedRow =
  | { rowIndex: number; status: 'error'; reason: string }
  | { rowIndex: number; status: 'skip'; reason: string }
  | { rowIndex: number; status: 'valid'; data: Record<string, unknown> };

/** Validates (never writes) one row. */
async function planRow(client: typeof prisma, type: ImportType, rowIndex: number, raw: unknown): Promise<PlannedRow> {
  const schema = type === 'STUDENTS' ? studentCsvRowSchema : teacherCsvRowSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { rowIndex, status: 'error', reason: parsed.error.issues[0]?.message ?? 'Invalid row' };
  }

  const existing = await client.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { rowIndex, status: 'skip', reason: 'Already exists' };
  }

  if (type === 'TEACHERS') {
    return { rowIndex, status: 'valid', data: parsed.data };
  }

  const row = parsed.data as z.infer<typeof studentCsvRowSchema>;
  const gradeLevel = await findGradeLevel(client, row.grade_level);
  if (!gradeLevel) {
    return { rowIndex, status: 'error', reason: `Grade level not found: ${row.grade_level}` };
  }

  const parents: ParsedParent[] = [];
  if (row.parent1_email && row.parent1_first_name && row.parent1_last_name) {
    parents.push({
      firstName: row.parent1_first_name,
      lastName: row.parent1_last_name,
      email: row.parent1_email,
      phone: row.parent1_phone,
      relationship: parentRelationship(row.parent1_relationship),
    });
  }
  if (row.parent2_email && row.parent2_first_name && row.parent2_last_name) {
    parents.push({
      firstName: row.parent2_first_name,
      lastName: row.parent2_last_name,
      email: row.parent2_email,
      phone: row.parent2_phone,
      relationship: parentRelationship(row.parent2_relationship),
    });
  }

  return { rowIndex, status: 'valid', data: { ...row, gradeLevelId: gradeLevel.id, parents } };
}

async function createStudentRow(tx: TxClient, data: Record<string, unknown>) {
  const row = data as z.infer<typeof studentCsvRowSchema> & { gradeLevelId: string; parents: ParsedParent[] };
  const user = await tx.user.create({
    data: { firstName: row.first_name, lastName: row.last_name, email: row.email, role: 'STUDENT', status: 'INVITED' },
  });
  await tx.studentProfile.create({
    data: {
      userId: user.id,
      admissionNumber: row.admission_number,
      dateOfBirth: row.date_of_birth,
      gradeLevelId: row.gradeLevelId,
      enrollmentDate: row.enrollment_date,
    },
  });

  let createdParents = 0;
  let linkedExistingParents = 0;
  const createdUserIds = [user.id];

  for (const parent of row.parents) {
    let parentUser = await tx.user.findUnique({ where: { email: parent.email } });
    if (parentUser) {
      linkedExistingParents += 1;
    } else {
      parentUser = await tx.user.create({
        data: { firstName: parent.firstName, lastName: parent.lastName, email: parent.email, phone: parent.phone, role: 'PARENT', status: 'INVITED' },
      });
      await tx.parentProfile.create({ data: { userId: parentUser.id } });
      createdParents += 1;
      createdUserIds.push(parentUser.id);
    }
    await linkParentToStudentTx(tx, {
      studentId: user.id,
      parentId: parentUser.id,
      relationship: parent.relationship,
      isPrimary: row.parents[0] === parent,
    });
  }

  return { createdParents, linkedExistingParents, createdUserIds };
}

async function createTeacherRow(tx: TxClient, data: Record<string, unknown>) {
  const row = data as z.infer<typeof teacherCsvRowSchema>;
  const user = await tx.user.create({
    data: { firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, role: 'TEACHER', status: 'INVITED' },
  });
  await tx.teacherProfile.create({ data: { userId: user.id, employeeNumber: row.employee_number, title: row.title } });
  return { createdUserIds: [user.id] };
}

export async function importUsers(type: ImportType, rows: unknown[], sendInvites: boolean): Promise<ImportSummary> {
  const rowResults: ImportRowResult[] = [];
  let createdPrimary = 0;
  let createdParents = 0;
  let linkedExistingParents = 0;
  let skipped = 0;
  let failed = 0;
  const allCreatedUserIds: string[] = [];

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const plan = await Promise.all(batch.map((raw, i) => planRow(prisma, type, start + i, raw)));
    const hasError = plan.some((p) => p.status === 'error');

    if (hasError) {
      for (const p of plan) {
        failed += 1;
        rowResults.push({
          rowIndex: p.rowIndex,
          result: 'error',
          reason: p.status === 'error' ? p.reason : 'Batch rolled back: another row in this batch failed.',
        });
      }
      continue;
    }

    const validPlans = plan.filter((p): p is PlannedRow & { status: 'valid' } => p.status === 'valid');
    if (validPlans.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const p of validPlans) {
          if (type === 'STUDENTS') {
            const result = await createStudentRow(tx, p.data);
            createdParents += result.createdParents;
            linkedExistingParents += result.linkedExistingParents;
            allCreatedUserIds.push(...result.createdUserIds);
          } else {
            const result = await createTeacherRow(tx, p.data);
            allCreatedUserIds.push(...result.createdUserIds);
          }
          createdPrimary += 1;
        }
      });
    }

    for (const p of plan) {
      if (p.status === 'skip') {
        skipped += 1;
        rowResults.push({ rowIndex: p.rowIndex, result: 'skipped', reason: p.reason });
      } else {
        rowResults.push({ rowIndex: p.rowIndex, result: 'created', reason: null });
      }
    }
  }

  if (sendInvites) {
    await Promise.all(allCreatedUserIds.map((id) => sendInvite(id)));
  }

  rowResults.sort((a, b) => a.rowIndex - b.rowIndex);

  // Contract (api-contracts.json) reuses `createdStudents` as the primary-row
  // created count for both import types — there is no `createdTeachers` field.
  return { createdStudents: createdPrimary, createdParents, linkedExistingParents, skipped, failed, rowResults };
}
