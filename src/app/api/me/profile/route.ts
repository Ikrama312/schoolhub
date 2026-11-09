import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { meProfileSchema } from '@/lib/validators/users';

/**
 * PATCH /api/me/profile — any authenticated user, self only (FR-27). A
 * narrower mutation path than /api/users/:id: only phone (+ occupation/
 * address for PARENT) are editable here; name/email/role are read-only.
 */
export const PATCH = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN', 'TEACHER', 'STUDENT', 'PARENT');
  const input = await parseBody(request, meProfileSchema);

  await prisma.user.update({ where: { id: actor.id }, data: { phone: input.phone } });

  if (actor.role === 'PARENT') {
    await prisma.parentProfile.update({
      where: { userId: actor.id },
      data: {
        ...(input.occupation !== undefined ? { occupation: input.occupation } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
    });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    include: { parentProfile: true },
  });

  return ok({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    phone: user.phone,
    occupation: user.parentProfile?.occupation ?? null,
    address: user.parentProfile?.address ?? null,
  });
});
