import { requirePageRole } from '@/server/auth/requireRole';
import { listScales } from '@/server/gradebook/scales-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { GradingScalesClient } from './GradingScalesClient';

export const dynamic = 'force-dynamic';

/** /admin/grading-scales — PRD-11 FR-16. */
export default async function GradingScalesPage() {
  await requirePageRole('ADMIN');
  const scales = await listScales();
  return (
    <>
      <PageHeader title="Grading scales" description="Letter grade bands used for term grades and report cards. Exactly one scale is the school default." />
      <GradingScalesClient initial={scales} />
    </>
  );
}
