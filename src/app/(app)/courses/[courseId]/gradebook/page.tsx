import { notFound, redirect } from 'next/navigation';
import Alert from '@mui/material/Alert';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getGradebook, type GradebookPayload } from '@/server/gradebook/gradebook-service';
import { GradebookGrid } from '@/components/gradebook/GradebookGrid';

export const dynamic = 'force-dynamic';

/** Course "Gradebook" tab — PRD-11 FR-18. getGradebook enforces manage access (NFR-6). */
export default async function GradebookPage({ params, searchParams }: { params: { courseId: string }; searchParams: { termId?: string } }) {
  const user = await requirePageUser();
  let data: GradebookPayload;
  try {
    data = await getGradebook(user, params.courseId, searchParams.termId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    if (error instanceof AppError && error.code === 'NOT_FOUND' && error.message.includes('no terms')) {
      return <Alert severity="info">{error.message} An administrator needs to add terms before grades can be recorded.</Alert>;
    }
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR')) notFound();
    throw error;
  }
  return <GradebookGrid initial={JSON.parse(JSON.stringify(data))} timezone={await getSchoolTimezone()} />;
}
