import { notFound, redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/requireRole';
import { assertCanManageCourse } from '@/server/auth/course-access';
import { AppError } from '@/server/http';
import { getCategories } from '@/server/gradebook/categories-service';
import { listScales } from '@/server/gradebook/scales-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { GradebookSettingsClient } from './GradebookSettingsClient';

export const dynamic = 'force-dynamic';

/** Course gradebook settings — PRD-11 FR-17. Manage access enforced here and in the API. */
export default async function GradebookSettingsPage({ params }: { params: { courseId: string } }) {
  const user = await requirePageUser();
  try {
    await assertCanManageCourse(user, params.courseId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const [settings, scales] = await Promise.all([getCategories(user, params.courseId), listScales()]);
  return (
    <>
      <PageHeader
        title="Gradebook settings"
        breadcrumbs={[{ label: 'Gradebook', href: `/courses/${params.courseId}/gradebook` }, { label: 'Settings' }]}
        description="Weighted categories and the grading scale for this course."
      />
      <GradebookSettingsClient courseId={params.courseId} initial={settings} scales={scales.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault }))} />
    </>
  );
}
