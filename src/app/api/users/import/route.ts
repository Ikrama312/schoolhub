import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { importUsers } from '@/server/services/userImport';
import { toCsv } from '@/server/csv';

const bodySchema = z.object({
  type: z.enum(['STUDENTS', 'TEACHERS']),
  rows: z.array(z.record(z.unknown())),
  sendInvites: z.boolean().default(false),
});

const ERROR_REPORT_COLUMNS = [
  { key: 'rowIndex', header: 'Row' },
  { key: 'result', header: 'Result' },
  { key: 'reason', header: 'Reason' },
];

/**
 * POST /api/users/import — ADMIN only (FR-18, FR-20..FR-23, NFR-3). Thin
 * dispatch onto component 9's batch transaction (src/server/services/
 * userImport.ts); this route only adds the error-report CSV (component 10)
 * and the audit write.
 */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, bodySchema);

  const summary = await importUsers(input.type, input.rows, input.sendInvites);

  const failedRows = summary.rowResults.filter((row) => row.result === 'error');
  const errorReportCsvUrl =
    failedRows.length > 0
      ? `data:text/csv;base64,${Buffer.from(toCsv(ERROR_REPORT_COLUMNS, failedRows)).toString('base64')}`
      : null;

  await audit({
    actorId: actor.id,
    action: 'user.imported',
    entityType: 'User',
    metadata: { type: input.type, ...summary, errorReportCsvUrl: undefined },
  });

  return ok({ ...summary, errorReportCsvUrl });
});
