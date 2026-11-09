import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { linkParentToStudent } from '@/server/services/userLinks';
import { GUARDIAN_RELATIONSHIP_VALUES } from '@/lib/validators/users';

const bodySchema = z.object({
  parentId: z.string().min(1),
  relationship: z.enum(GUARDIAN_RELATIONSHIP_VALUES),
  isPrimary: z.boolean().default(false),
});

/** POST /api/students/:id/parents — ADMIN only, link a parent (FR-15, FR-16). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, bodySchema);

  const link = await linkParentToStudent({ studentId: params.id, ...input });
  await audit({
    actorId: actor.id,
    action: 'parent_link.created',
    entityType: 'User',
    entityId: params.id,
    metadata: { parentId: input.parentId },
  });

  return ok(
    { id: link.id, parentId: link.parentId, studentId: link.studentId, relationship: link.relationship, isPrimary: link.isPrimary },
    { status: 201 },
  );
});
