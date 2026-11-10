'use client';

import { useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useToast } from '@/components/Toast/useToast';
import { PARENT_NOTE_MAX } from '@/lib/validators/conferences';
import type { ConferenceSlotDto } from '@/server/conferences/conferences-service';

interface Props {
  eventId: string;
  studentId: string;
  childName: string;
  bookingOpen: boolean;
  timezone: string;
  initialSlots: ConferenceSlotDto[];
}

/** FR-30 to FR-32, NFR-1: one section per teacher; 409 → toast + refetch. Reschedule = cancel + book. */
export function BookingClient({ eventId, studentId, childName, bookingOpen, timezone, initialSlots }: Props) {
  const { showToast } = useToast();
  const [slots, setSlots] = useState(initialSlots);
  const [picked, setPicked] = useState<ConferenceSlotDto | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const hm = (iso: string) => formatInTimeZone(new Date(iso), timezone, 'HH:mm');

  const teachers = useMemo(() => {
    const byId = new Map<string, { teacher: ConferenceSlotDto['teacher']; slots: ConferenceSlotDto[] }>();
    for (const s of slots) {
      const g = byId.get(s.teacher.id) ?? { teacher: s.teacher, slots: [] };
      g.slots.push(s);
      byId.set(s.teacher.id, g);
    }
    return [...byId.values()].sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));
  }, [slots]);

  async function refetch() {
    const res = await fetch(`/api/conferences/${eventId}/slots?studentId=${encodeURIComponent(studentId)}`);
    if (res.ok) setSlots((await res.json()).data);
  }

  async function post(url: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ message: json?.error?.message ?? 'Something went wrong.', severity: 'error' });
        if (res.status === 409) await refetch();
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking() {
    if (!picked) return;
    if (await post(`/api/conference-slots/${picked.id}/book`, { studentId, parentNote: note.trim() || undefined })) {
      showToast({ message: `Booked ${hm(picked.startsAt)} with ${picked.teacher.name}`, severity: 'success' });
      await refetch();
    }
    setPicked(null);
    setNote('');
  }

  async function cancelBooking(s: ConferenceSlotDto) {
    if (await post(`/api/conference-slots/${s.id}/cancel`)) {
      showToast({ message: 'Booking cancelled', severity: 'success' });
      await refetch();
    }
  }

  return (
    <Stack spacing={2}>
      {!bookingOpen && <Alert severity="info">Booking is closed for this event.</Alert>}
      {teachers.map(({ teacher, slots: own }) => {
        const mine = own.find((s) => s.mine && s.booking?.student.id === studentId);
        return (
          <Card key={teacher.id} variant="outlined" component="section" aria-label={teacher.name}>
            <CardContent>
              <Typography variant="h6">{teacher.name}</Typography>
              {teacher.subjects.length > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {teacher.subjects.join(', ')}
                </Typography>
              )}
              {mine ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <Alert severity="success" sx={{ flexGrow: 1 }}>
                    Booked for {childName}: {hm(mine.startsAt)}–{hm(mine.endsAt)}
                    {mine.location ? ` · ${mine.location}` : ''}
                  </Alert>
                  <Link href={`/api/conference-slots/${mine.id}/ics`}>Add to calendar</Link>
                  {bookingOpen && (
                    <Button color="error" onClick={() => void cancelBooking(mine)} disabled={busy}>
                      Cancel booking
                    </Button>
                  )}
                </Stack>
              ) : (
                <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {own.filter((s) => s.available).length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No free slots.
                    </Typography>
                  )}
                  {own
                    .filter((s) => s.available)
                    .map((s) => (
                      <Button key={s.id} variant="outlined" size="small" disabled={!bookingOpen || busy} onClick={() => setPicked(s)} aria-label={`Book ${hm(s.startsAt)} with ${teacher.name}`}>
                        {hm(s.startsAt)}
                      </Button>
                    ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={picked !== null} onClose={() => !busy && setPicked(null)} fullWidth maxWidth="xs">
        {picked && (
          <>
            <DialogTitle>
              Book {hm(picked.startsAt)} with {picked.teacher.name}
            </DialogTitle>
            <DialogContent>
              <TextField
                label="Note for the teacher (optional)"
                multiline
                minRows={3}
                fullWidth
                sx={{ mt: 1 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                helperText={`${note.length}/${PARENT_NOTE_MAX}`}
                slotProps={{ htmlInput: { maxLength: PARENT_NOTE_MAX } }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPicked(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="contained" onClick={() => void confirmBooking()} disabled={busy}>
                Confirm booking
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Stack>
  );
}
