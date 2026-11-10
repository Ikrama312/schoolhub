import { notFound } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { getEvent, listSlots } from '@/server/conferences/conferences-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AvailabilityClient } from './AvailabilityClient';

/** /conferences/[id]/availability — TEACHER sets time ranges; unbooked slots are regenerated (FR-29). */
export default async function AvailabilityPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('TEACHER');
  const event = await getEvent(user, params.id).catch(() => notFound());
  const slots = await listSlots(user, params.id, {});
  return (
    <>
      <PageHeader
        title={`Availability — ${event.title}`}
        description={`${event.date} · ${event.slotMinutes}-minute slots. Booked and blocked slots are kept when you regenerate.`}
        breadcrumbs={[{ label: 'Conferences', href: '/conferences' }, { label: event.title }, { label: 'Availability' }]}
      />
      <AvailabilityClient eventId={params.id} initialSlots={slots} />
    </>
  );
}
