import { requirePageUser } from '@/server/auth/requireRole';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ChangePasswordForm } from './ChangePasswordForm';

export const dynamic = 'force-dynamic';

/** /account/security — C5 (FR-23). */
export default async function AccountSecurityPage() {
  const user = await requirePageUser();
  return (
    <>
      <PageHeader title="Account security" description="Change the password you use to sign in." />
      <ChangePasswordForm email={user.email} />
    </>
  );
}
