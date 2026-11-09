import { prisma } from '@/server/db';

export interface EnqueueEmailInput {
  toEmail: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
}

/** Inserts one PENDING outbox row; the dispatcher sends it (NFR-3: no SMTP on the request path). */
export function enqueueEmail(input: EnqueueEmailInput) {
  return prisma.emailOutbox.create({ data: { ...input, toName: input.toName ?? null }, select: { id: true } });
}
