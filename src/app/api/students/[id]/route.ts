import { prisma } from '@/server/db';
import { ok, withHandler, AppError } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { listLinksForStudent } from '@/server/services/userLinks';

/**
 * GET /api/students/:id — gated by assertCanViewStudent (FR-24, FR-25,
 * NFR-1). medicalNotes is stripped here, in the service/route layer,
 * before the response is built — never a client-side hide.
 */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN', 'TEACHER', 'STUDENT', 'PARENT');
  await assertCanViewStudent(actor, params.id);

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: { studentProfile: { include: { gradeLevel: true } } },
  });

  if (!user || !user.studentProfile) {
    throw new AppError('NOT_FOUND', 'Resource not found');
  }

  const links = await listLinksForStudent(params.id);
  const canSeeMedicalNotes = actor.role === 'ADMIN' || actor.role === 'TEACHER';
  const profile = user.studentProfile;

  return ok({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    admissionNumber: profile.admissionNumber,
    gradeLevelId: profile.gradeLevelId,
    gradeLevelName: profile.gradeLevel.name,
    status: user.status,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    addressLine1: profile.addressLine1,
    city: profile.city,
    medicalNotes: canSeeMedicalNotes ? profile.medicalNotes : undefined,
    emergencyContact: profile.emergencyContact,
    emergencyPhone: profile.emergencyPhone,
    familyLinks: links.map((link) => ({
      linkedUserId: link.parentId,
      linkedUserName: `${link.parent.firstName} ${link.parent.lastName}`,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
    })),
  });
});
