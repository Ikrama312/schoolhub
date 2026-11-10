import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { getCurrentUser } from '@/server/auth/requireRole';

export default async function DashboardPage() {
  // PRD-15 FR-8: the child overview is the parent landing page.
  if ((await getCurrentUser())?.role === 'PARENT') redirect('/my-children');
  return (
    <div>
      <PageHeader title="Welcome to SchoolHub" />
      <EmptyState
        title="Dashboards arrive in a later release"
        description="This space will show your personalized overview once dashboard PRDs land."
      />
    </div>
  );
}
