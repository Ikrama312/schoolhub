import { notFound } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getCourse, getCourseRoster } from '@/server/courses/courses-service';
import { EnrollmentClient } from './EnrollmentClient';

export const dynamic = 'force-dynamic';

/** /admin/courses/[id]/enrollment — PRD-05 FR-11/FR-12/FR-15. */
export default async function CourseEnrollmentPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN');
  const course = await getCourse(params.id).catch((error) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const roster = await getCourseRoster(course.id, user.role, { status: 'ALL' });

  return (
    <EnrollmentClient
      course={JSON.parse(
        JSON.stringify({
          id: course.id,
          name: course.name,
          code: course.code,
          kind: course.kind,
          capacity: course.capacity,
          enrolledCount: course.enrolledCount,
          section: course.section,
        }),
      )}
      roster={JSON.parse(JSON.stringify(roster.rows))}
    />
  );
}
