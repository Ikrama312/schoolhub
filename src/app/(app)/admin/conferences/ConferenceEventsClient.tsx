'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import type { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import { conferenceEventInputSchema, SLOT_MINUTES_MAX, SLOT_MINUTES_MIN, type ConferenceEventInput } from '@/lib/validators/conferences';
import type { ConferenceEventDto } from '@/server/conferences/conferences-service';

type Grade = { id: string; name: string };
const SORTABLE = ['date', 'title'];
const toLocalDate = (d: string) => new Date(`${d}T00:00:00`);

function defaults(e?: ConferenceEventDto): ConferenceEventInput {
  if (e) {
    return { title: e.title, date: e.date, bookingOpensAt: e.bookingOpensAt, bookingClosesAt: e.bookingClosesAt, slotMinutes: e.slotMinutes, gradeLevelIds: e.gradeLevels.map((g) => g.id) };
  }
  const now = new Date();
  return { title: '', date: format(new Date(now.getTime() + 21 * 86_400_000), 'yyyy-MM-dd'), bookingOpensAt: now.toISOString(), bookingClosesAt: new Date(now.getTime() + 20 * 86_400_000).toISOString(), slotMinutes: 10, gradeLevelIds: [] };
}

function EventDialog({ open, event, gradeLevels, onClose, onSaved }: { open: boolean; event?: ConferenceEventDto; gradeLevels: Grade[]; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast();
  const { control, handleSubmit, reset, setError, formState } = useForm<ConferenceEventInput>({ resolver: zodResolver(conferenceEventInputSchema), defaultValues: defaults(event) });
  useEffect(() => reset(defaults(event)), [event, open, reset]);
  const err = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    const res = await fetch(event ? `/api/conferences/${event.id}` : '/api/conferences', {
      method: event ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      for (const [f, msgs] of Object.entries((json?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>)) setError(f as keyof ConferenceEventInput, { message: msgs[0] });
      showToast({ message: json?.error?.message ?? 'Could not save the event.', severity: 'error' });
      return;
    }
    showToast({ message: event ? 'Event updated' : 'Event created; eligible teachers were asked for availability', severity: 'success' });
    onSaved();
  });

  return (
    <Dialog open={open} onClose={() => !formState.isSubmitting && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{event ? 'Edit conference event' : 'New conference event'}</DialogTitle>
      <DialogContent>
        <Stack component="form" id="conference-event-form" spacing={2} sx={{ pt: 1 }} onSubmit={onSubmit} noValidate>
          <Controller name="title" control={control} render={({ field }) => <TextField label="Title" {...field} error={!!err.title} helperText={err.title?.message} />} />
          <Controller
            name="date"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="Conference date"
                value={field.value ? toLocalDate(field.value) : null}
                onChange={(d) => field.onChange(d && !Number.isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : '')}
                slotProps={{ textField: { error: !!err.date, helperText: err.date?.message } }}
              />
            )}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {(['bookingOpensAt', 'bookingClosesAt'] as const).map((name) => (
              <Controller
                key={name}
                name={name}
                control={control}
                render={({ field }) => (
                  <DateTimePicker
                    label={name === 'bookingOpensAt' ? 'Booking opens' : 'Booking closes'}
                    ampm={false}
                    value={field.value ? new Date(field.value) : null}
                    onChange={(d) => field.onChange(d && !Number.isNaN(d.getTime()) ? d.toISOString() : '')}
                    slotProps={{ textField: { fullWidth: true, error: !!err[name], helperText: err[name]?.message } }}
                  />
                )}
              />
            ))}
          </Stack>
          <Controller
            name="slotMinutes"
            control={control}
            render={({ field }) => (
              <TextField
                type="number"
                label="Slot length (minutes)"
                value={field.value}
                onChange={(e) => field.onChange(Number(e.target.value))}
                error={!!err.slotMinutes}
                helperText={err.slotMinutes?.message ?? (event ? 'Cannot change once slots are booked' : undefined)}
                slotProps={{ htmlInput: { min: SLOT_MINUTES_MIN, max: SLOT_MINUTES_MAX } }}
              />
            )}
          />
          <Controller
            name="gradeLevelIds"
            control={control}
            render={({ field }) => (
              <Autocomplete
                multiple
                options={gradeLevels}
                getOptionLabel={(g) => g.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                value={gradeLevels.filter((g) => field.value.includes(g.id))}
                onChange={(_, v) => field.onChange(v.map((g) => g.id))}
                renderInput={(params) => <TextField {...params} label="Eligible grade levels" error={!!err.gradeLevelIds} helperText={err.gradeLevelIds?.message} />}
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" form="conference-event-form" variant="contained" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** FR-28: event list + create/edit dialog. */
export function ConferenceEventsClient({ gradeLevels }: { gradeLevels: Grade[] }) {
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<ConferenceEventDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; event?: ConferenceEventDto }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    for (const k of ['page', 'pageSize', 'q']) if (searchParams.get(k)) q.set(k, searchParams.get(k)!);
    const sort = searchParams.get('sort');
    if (sort && SORTABLE.includes(sort)) q.set('sort', `${sort}:${searchParams.get('order') ?? 'desc'}`);
    const res = await fetch(`/api/conferences?${q}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setRows(json.data);
      setTotal(json.meta.total);
    } else showToast({ message: json?.error?.message ?? 'Could not load events.', severity: 'error' });
    setLoading(false);
  }, [searchParams, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: GridColDef[] = [
    { field: 'title', headerName: 'Title', flex: 1 },
    { field: 'date', headerName: 'Date', width: 120 },
    { field: 'slotMinutes', headerName: 'Slot', width: 80, sortable: false, valueGetter: (v) => `${v} min` },
    { field: 'gradeLevels', headerName: 'Grade levels', flex: 1, sortable: false, valueGetter: (_v, r) => r.gradeLevels.map((g: Grade) => g.name).join(', ') },
    {
      field: 'bookingOpen',
      headerName: 'Booking',
      width: 120,
      sortable: false,
      renderCell: (p) => <Chip size="small" color={p.row.bookingOpen ? 'success' : 'default'} label={p.row.bookingOpen ? 'Open' : 'Closed'} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 180,
      sortable: false,
      renderCell: (p) => (
        <Box>
          <Button size="small" onClick={() => setDialog({ open: true, event: p.row })}>
            Edit
          </Button>
          <Button size="small" component={NextLink} href={`/conferences/${p.row.id}/day`}>
            Bookings
          </Button>
        </Box>
      ),
    },
  ];

  return (
    <>
      <Stack direction="row" sx={{ mb: 2, justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true })}>
          New event
        </Button>
      </Stack>
      <DataTable columns={columns} rows={rows as unknown as Record<string, unknown>[]} total={total} loading={loading} />
      <EventDialog
        open={dialog.open}
        event={dialog.event}
        gradeLevels={gradeLevels}
        onClose={() => setDialog({ open: false })}
        onSaved={() => {
          setDialog({ open: false });
          void load();
        }}
      />
    </>
  );
}
