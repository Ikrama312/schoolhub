import type { Prisma, Role, UserStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { createToken, INVITE_TTL } from '@/server/auth/tokens';
import { authLink, sendAuthEmail } from '@/server/auth/email';
import { linkParentToStudentTx } from '@/server/services/userLinks';
import {
  studentProfileSchema,
  teacherProfileSchema,
  parentProfileSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/lib/validators/users';

type TxClient = Prisma.TransactionClient;

/**
 * Core user service (component 2, FR-1..FR-14/FR-31). Every write endpoint
 * under /api/users and /api/me goes through here instead of touching
 * prisma.user directly, so the role-immutability, self/last-admin and
 * admission/employee-number invariants live in exactly one place.
 */

// ---- number generators (FR-1) ----
// ponytail: zero-padded(4) string ordering breaks past 9999 of either kind
// in one year/ever; widen the pad or switch to a sequence table if a school
// actually enrolls that many students/teachers.

async function generateAdmissionNumber(tx: TxClient): Promise<string> {
  const prefix = `S${new Date().getUTCFullYear()}-`;
  const last = await tx.studentProfile.findFirst({
    where: { admissionNumber: { startsWith: prefix } },
    orderBy: { admissionNumber: 'desc' },
  });
  const next = last ? parseInt(last.admissionNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function generateEmployeeNumber(tx: TxClient): Promise<string> {
  const prefix = 'T-';
  const last = await tx.teacherProfile.findFirst({
    where: { employeeNumber: { startsWith: prefix } },
    orderBy: { employeeNumber: 'desc' },
  });
  const next = last ? parseInt(last.employeeNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ---- shared read shaping ----

const detailInclude = {
  studentProfile: { include: { gradeLevel: true } },
  teacherProfile: true,
  parentProfile: true,
} satisfies Prisma.UserInclude;

type UserWithProfile = Prisma.UserGetPayload<{ include: typeof detailInclude }>;

function buildProfile(user: UserWithProfile): Record<string, unknown> | null {
  if (user.role === 'STUDENT' && user.studentProfile) {
    const { userId: _userId, gradeLevel, ...rest } = user.studentProfile;
    return { ...rest, gradeLevelName: gradeLevel?.name ?? null };
  }
  if (user.role === 'TEACHER' && user.teacherProfile) {
    const { userId: _userId, ...rest } = user.teacherProfile;
    return rest;
  }
  if (user.role === 'PARENT' && user.parentProfile) {
    const { userId: _userId, ...rest } = user.parentProfile;
    return rest;
  }
  return null;
}

function toUserDto(user: UserWithProfile) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone,
    isSafeguardingLead: user.isSafeguardingLead,
    isBursar: user.isBursar,
    profile: buildProfile(user),
  };
}

async function getUserWithProfile(tx: TxClient | typeof prisma, id: string) {
  const user = await tx.user.findUnique({ where: { id }, include: detailInclude });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  return toUserDto(user);
}

function pick<T extends object>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

const STUDENT_PROFILE_KEYS = [
  'dateOfBirth',
  'gender',
  'gradeLevelId',
  'enrollmentDate',
  'addressLine1',
  'city',
  'medicalNotes',
  'emergencyContact',
  'emergencyPhone',
] as const;
const TEACHER_PROFILE_KEYS = ['title', 'qualifications', 'hireDate'] as const;
const PARENT_PROFILE_KEYS = ['occupation', 'address'] as const;

// ---- create / update (FR-1, FR-6..FR-10, FR-15, FR-16) ----

export async function createUser(input: CreateUserInput) {
  const userId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email.trim().toLowerCase(), // FR-2: login lower-cases, so stored emails must be too
        phone: input.phone,
        role: input.role,
        status: 'INVITED',
      },
    });

    if (input.role === 'STUDENT') {
      const profile = studentProfileSchema.parse(input.profile ?? {});
      const admissionNumber = await generateAdmissionNumber(tx);
      await tx.studentProfile.create({ data: { userId: user.id, admissionNumber, ...profile } });
    } else if (input.role === 'TEACHER') {
      const profile = teacherProfileSchema.parse(input.profile ?? {});
      const employeeNumber = await generateEmployeeNumber(tx);
      await tx.teacherProfile.create({ data: { userId: user.id, employeeNumber, ...profile } });
    } else if (input.role === 'PARENT') {
      const profile = parentProfileSchema.parse(input.profile ?? {});
      await tx.parentProfile.create({ data: { userId: user.id, ...profile } });
    }

    for (const link of input.links ?? []) {
      if (input.role === 'STUDENT') {
        await linkParentToStudentTx(tx, {
          studentId: user.id,
          parentId: link.linkedUserId,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        });
      } else if (input.role === 'PARENT') {
        await linkParentToStudentTx(tx, {
          studentId: link.linkedUserId,
          parentId: user.id,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        });
      }
    }

    return user.id;
  });

  if (input.sendInvite) {
    await sendInvite(userId);
  }

  return getUserWithProfile(prisma, userId);
}

export async function updateUser(id: string, input: UpdateUserInput, options: { actorId?: string } = {}) {
  let leadChange: { old: boolean; new: boolean } | null = null;
  let bursarChange: { old: boolean; new: boolean } | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUniqueOrThrow({ where: { id } });
    const emailChanged = input.email !== undefined && input.email !== existing.email;

    // PRD-13 FR-2 / ADR-11: the flag is meaningful only for ADMIN.
    if (input.isSafeguardingLead === true && existing.role !== 'ADMIN') {
      throw new AppError('VALIDATION_ERROR', 'Only administrators can be safeguarding leads.', {
        reason: 'SAFEGUARDING_LEAD_REQUIRES_ADMIN',
      });
    }
    if (input.isSafeguardingLead !== undefined && input.isSafeguardingLead !== existing.isSafeguardingLead) {
      leadChange = { old: existing.isSafeguardingLead, new: input.isSafeguardingLead };
    }
    // PRD-17 FR-5 / D-14: same rule for the bursar flag.
    if (input.isBursar === true && existing.role !== 'ADMIN') {
      throw new AppError('VALIDATION_ERROR', 'Only administrators can be bursars.', { reason: 'BURSAR_REQUIRES_ADMIN' });
    }
    if (input.isBursar !== undefined && input.isBursar !== existing.isBursar) {
      bursarChange = { old: existing.isBursar, new: input.isBursar };
    }

    await tx.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        isSafeguardingLead: input.isSafeguardingLead,
        isBursar: input.isBursar,
      },
    });

    if (input.profile) {
      if (existing.role === 'STUDENT') {
        const data = pick(input.profile, STUDENT_PROFILE_KEYS);
        if (Object.keys(data).length > 0) {
          await tx.studentProfile.update({ where: { userId: id }, data });
        }
      } else if (existing.role === 'TEACHER') {
        const data = pick(input.profile, TEACHER_PROFILE_KEYS);
        if (Object.keys(data).length > 0) {
          await tx.teacherProfile.update({ where: { userId: id }, data });
        }
      } else if (existing.role === 'PARENT') {
        const data = pick(input.profile, PARENT_PROFILE_KEYS);
        if (Object.keys(data).length > 0) {
          await tx.parentProfile.update({ where: { userId: id }, data });
        }
      }
    }

    if (emailChanged) {
      // FR-8: a stale invite link must not activate the old address.
      await tx.authToken.updateMany({
        where: { userId: id, type: 'INVITE', usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    return getUserWithProfile(tx, id);
  });
  // NFR-11: old → new in user.update metadata (the route's own audit row lists changed fields).
  if (leadChange) {
    await audit({ actorId: options.actorId, action: 'user.update', entityType: 'User', entityId: id, metadata: { isSafeguardingLead: leadChange } });
  }
  if (bursarChange) {
    await audit({ actorId: options.actorId, action: 'user.update', entityType: 'User', entityId: id, metadata: { isBursar: bursarChange } });
  }
  return result;
}

// ---- list / detail (FR-2, FR-3, FR-11, NFR-2) ----

export interface ListUsersFilters {
  role?: Role[];
  status?: UserStatus;
  gradeLevelId?: string;
  q?: string;
  includeArchived?: boolean;
}

function searchClauses(q: string): Prisma.UserWhereInput[] {
  return [
    { firstName: { contains: q, mode: 'insensitive' } },
    { lastName: { contains: q, mode: 'insensitive' } },
    { email: { contains: q, mode: 'insensitive' } },
    { studentProfile: { admissionNumber: { contains: q, mode: 'insensitive' } } },
    { teacherProfile: { employeeNumber: { contains: q, mode: 'insensitive' } } },
  ];
}

export async function listUsers(filters: ListUsersFilters, pagination: { skip: number; take: number }) {
  const where: Prisma.UserWhereInput = {
    ...(filters.role && filters.role.length > 0 ? { role: { in: filters.role } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.includeArchived ? {} : { archivedAt: null }),
    ...(filters.gradeLevelId ? { studentProfile: { gradeLevelId: filters.gradeLevelId } } : {}),
    ...(filters.q ? { OR: searchClauses(filters.q) } : {}),
  };

  // Ordered by (lastName, firstName) to use the composite index (NFR-2).
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { studentProfile: { include: { gradeLevel: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      role: row.role,
      status: row.status,
      gradeLevelId: row.studentProfile?.gradeLevelId ?? null,
      gradeLevelName: row.studentProfile?.gradeLevel.name ?? null,
      lastLoginAt: row.lastLoginAt,
      lockedUntil: row.lockedUntil,
    })),
    total,
  };
}

export async function getUserDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      ...detailInclude,
      parentLinks: { include: { student: { select: { id: true, firstName: true, lastName: true } } } },
      studentLinks: { include: { parent: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');

  const familyLinks =
    user.role === 'STUDENT'
      ? user.studentLinks.map((link) => ({
          id: link.id,
          linkedUserId: link.parentId,
          linkedUserName: `${link.parent.firstName} ${link.parent.lastName}`,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        }))
      : user.role === 'PARENT'
        ? user.parentLinks.map((link) => ({
            id: link.id,
            linkedUserId: link.studentId,
            linkedUserName: `${link.student.firstName} ${link.student.lastName}`,
            relationship: link.relationship,
            isPrimary: link.isPrimary,
          }))
        : [];

  const recentAuditLogs = await prisma.auditLog.findMany({
    where: { OR: [{ actorId: id }, { entityId: id }] },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    ...toUserDto(user),
    lastLoginAt: user.lastLoginAt,
    familyLinks,
    recentAuditLogs: recentAuditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      actorId: log.actorId,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt,
    })),
  };
}

// ---- status / archive / unlock (FR-12, FR-13, FR-14, FR-31) ----

/** Self-disable and last-active-admin guards shared by setUserStatus/archiveUser. */
async function assertNotSelfOrLastAdmin(tx: TxClient, actorId: string, userId: string) {
  if (actorId === userId) {
    throw new AppError('VALIDATION_ERROR', 'You cannot disable your own account.');
  }
  const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === 'ADMIN') {
    const activeAdmins = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', archivedAt: null, id: { not: userId } },
    });
    if (activeAdmins === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one active admin is required.');
    }
  }
}

export async function setUserStatus(actorId: string, userId: string, status: 'ACTIVE' | 'DISABLED') {
  return prisma.$transaction(async (tx) => {
    if (status === 'DISABLED') {
      await assertNotSelfOrLastAdmin(tx, actorId, userId);
    }
    return tx.user.update({ where: { id: userId }, data: { status }, select: { id: true, status: true } });
  });
}

export async function archiveUser(actorId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    await assertNotSelfOrLastAdmin(tx, actorId, userId);
    return tx.user.update({
      where: { id: userId },
      data: { status: 'DISABLED', archivedAt: new Date() },
      select: { id: true, status: true, archivedAt: true },
    });
  });
}

export async function restoreUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { archivedAt: null },
    select: { id: true, status: true, archivedAt: true },
  });
}

/** FR-31: clears exactly the two lockout fields that exist in the schema today. */
export async function unlockUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { lockedUntil: null, failedLoginCount: 0 },
    select: { id: true, lockedUntil: true, failedLoginCount: true },
  });
}

/** FR-26: a fresh 7-day INVITE token (older unused ones are invalidated). Returns the raw token. */
export function createInviteToken(userId: string): Promise<string> {
  return createToken(userId, 'INVITE', INVITE_TTL);
}

/**
 * FR-25/FR-27: issue an invite token and email the link. Call sites
 * (POST /api/users/:id/invite, createUser's sendInvite checkbox, CSV import)
 * keep the same {id, inviteSentAt} shape.
 */
export async function sendInvite(userId: string): Promise<{ id: string; inviteSentAt: Date }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  const raw = await createInviteToken(userId);
  await sendAuthEmail(user, 'invite', authLink('invite', raw));
  return { id: userId, inviteSentAt: new Date() };
}
