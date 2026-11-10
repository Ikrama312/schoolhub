import { notFound, redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/requireRole';
import { GreetingHeader } from './_components/GreetingHeader';
import { RefreshButton } from './_components/RefreshButton';
import { AdminDashboard } from './_components/AdminDashboard';
import { TeacherDashboard } from './_components/TeacherDashboard';
import { StudentDashboard } from './_components/StudentDashboard';

/** PRD-16 FR-1: one dashboard per role; parents land on the child overview (PRD-15 FR-8). */
export default async function DashboardPage() {
  const user = await requirePageUser();
  if (user.role === 'PARENT') redirect('/my-children');

  const body =
    user.role === 'ADMIN' ? (
      <AdminDashboard user={user} />
    ) : user.role === 'TEACHER' ? (
      <TeacherDashboard user={user} />
    ) : user.role === 'STUDENT' ? (
      <StudentDashboard user={user} />
    ) : null;
  if (!body) notFound();

  return (
    <div>
      <GreetingHeader firstName={user.firstName} actions={user.role === 'ADMIN' ? <RefreshButton /> : undefined} />
      {body}
    </div>
  );
}
