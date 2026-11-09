import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getClientIp } from '@/server/http';
import { logger } from '@/lib/logger';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  /** When given, the client IP (x-forwarded-for) is stored in AuditLog.ip (FR-30). */
  request?: Request;
}

// FR-31 defence in depth: callers pass explicit metadata, this strips secrets anyway.
const SECRET_KEYS = ['password', 'passwordHash', 'newPassword', 'currentPassword', 'token', 'rawToken'];

/**
 * Insert-only audit trail, the single writer of AuditLog rows. Every write
 * endpoint calls this after a successful mutation with action
 * `<entity>.create|update|archive|delete`. Never throws -- a failed audit
 * write must not fail the request it's recording, so errors are logged
 * and swallowed.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const metadata = input.metadata
      ? Object.fromEntries(Object.entries(input.metadata).filter(([key]) => !SECRET_KEYS.includes(key)))
      : undefined;
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
        ip: input.request ? getClientIp(input.request) : null,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
