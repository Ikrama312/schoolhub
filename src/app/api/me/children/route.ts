import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { listLinksForParent } from '@/server/services/userLinks';

/** GET /api/me/children — PARENT only (FR-26). */
export const GET = withHandler(async () => {
  const actor = await requireRole('PARENT');
  const links = await listLinksForParent(actor.id);

  const children = await Promise.all(
    links.map(async (link) => {
      const { prisma } = await import('@/server/db');
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: link.studentId },
        include: { gradeLevel: true },
      });
      return {
        id: link.studentId,
        name: `${link.student.firstName} ${link.student.lastName}`,
        gradeLevelName: profile?.gradeLevel.name ?? null,
        admissionNumber: profile?.admissionNumber ?? null,
      };
    }),
  );

  return ok(children);
});
