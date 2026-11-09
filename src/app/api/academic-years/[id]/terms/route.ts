import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { createTerm } from '@/server/services/terms';

const createSchema = z.object({
  name: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, createSchema);
  const term = await createTerm(params.id, input);
  await audit({ actorId: actor.id, action: 'term.create', entityType: 'Term', entityId: term.id });
  return ok(term, { status: 201 });
});
