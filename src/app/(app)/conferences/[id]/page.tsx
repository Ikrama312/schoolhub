import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { getEvent, listSlots } from '@/server/conferences/conferences-service';
import { getSelectedChild } from '@/server/parent/selected-child';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { BookingClient } from './BookingClient';

/** /conferences/[id] — PARENT books slots for the selected child (FR-5, FR-30 to FR-32). Staff go to their own views. */
export default async function ConferenceBookingPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const user = await requirePageUser();
  if (user.role === 'TEACHER') redirect(`/conferences/${params.id}/availability`);
  if (user.role !== 'PARENT') redirect(`/conferences/${params.id}/day`);
  const child = await getSelectedChild(user, searchParams);
  if (!child) notFound();
  const event = await getEvent(user, params.id, { studentId: child.studentId }).catch(() => notFound());
  const [slots, settings] = await Promise.all([
    listSlots(user, params.id, { studentId: child.studentId }),
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } }),
  ]);
  return (
    <>
      <PageHeader
        title={event.title}
        description={`${event.date} · booking for ${child.firstName} ${child.lastName}. ${event.bookingOpen ? `Booking closes ${new Date(event.bookingClosesAt).toLocaleString()}.` : 'Booking is closed.'}`}
        breadcrumbs={[{ label: 'Conferences', href: '/conferences' }, { label: event.title }]}
      />
      {slots.length === 0 ? (
        <EmptyState title="No slots yet" description={`${child.firstName}'s teachers haven't published their availability yet.`} />
      ) : (
        <BookingClient
          eventId={params.id}
          studentId={child.studentId}
          childName={child.firstName}
          bookingOpen={event.bookingOpen}
          timezone={settings?.timezone ?? 'UTC'}
          initialSlots={slots}
        />
      )}
    </>
  );
}
