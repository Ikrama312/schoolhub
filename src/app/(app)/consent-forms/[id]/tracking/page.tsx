import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { get } from '@/server/consent-forms/consent-forms-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { ConsentTrackingClient } from './ConsentTrackingClient';

/** /consent-forms/[id]/tracking — creator or ADMIN (FR-39). */
export default async function ConsentTrackingPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN', 'TEACHER');
  const form = await get(user, params.id).catch(() => notFound());
  if (!('counts' in form)) redirect('/forbidden');
  return (
    <>
      <PageHeader
        title={`Responses — ${form.title}`}
        description={`Due ${new Date(form.dueAt).toLocaleString()}`}
        breadcrumbs={[{ label: 'Consent forms', href: '/consent-forms' }, { label: form.title, href: `/consent-forms/${form.id}` }, { label: 'Tracking' }]}
      />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <ConsentTrackingClient formId={form.id} pastDue={Date.parse(form.dueAt) <= Date.now()} lastRemindedAt={form.lastRemindedAt} />
      </Suspense>
    </>
  );
}
