import { ok, withHandler, AppError } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { getUserDetail, updateUser } from '@/server/services/users';
import { updateUserSchema } from '@/lib/validators/users';

/** GET/PATCH /api/users/:id — ADMIN only (FR-8, FR-9, FR-10, FR-11). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  await requireRole('ADMIN');
  const detail = await getUserDetail(params.id);
  return ok(detail);
});

export const PATCH = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const json = await request.json();

  // FR-9: role is immutable — reject outright if the client sends a
  // different one rather than silently dropping it, so the form's "role
  // is read-only on edit" convention is also a real server-side guarantee.
  if ('role' in json) {
    const existing = await getUserDetail(params.id);
    if (json.role !== existing.role) {
      throw new AppError('VALIDATION_ERROR', 'Role cannot be changed after a user is created.');
    }
  }

  const input = updateUserSchema.parse(json);
  const user = await updateUser(params.id, input);
  await audit({
    actorId: actor.id,
    action: 'user.updated',
    entityType: 'User',
    entityId: params.id,
    metadata: { fields: Object.keys(input) },
  });

  return ok(user);
});
