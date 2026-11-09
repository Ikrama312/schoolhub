import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export default function DashboardPage() {
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
