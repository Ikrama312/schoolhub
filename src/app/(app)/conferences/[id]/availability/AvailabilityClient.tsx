'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import BlockIcon from '@mui/icons-material/Block';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useToast } from '@/components/Toast/useToast';
import { availabilitySchema, LOCATION_MAX, MAX_RANGES } from '@/lib/validators/conferences';
import type { ConferenceSlotDto } from '@/server/conferences/conferences-service';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** FR-29: time-range rows → PUT availability; per-slot remove / block. */
export function AvailabilityClient({ eventId, initialSlots }: { eventId: string; initialSlots: ConferenceSlotDto[] }) {
  const { showToast } = useToast();
  const [slots, setSlots] = useState(initialSlots);
  const [ranges, setRanges] = useState([{ start: '15:00', end: '17:00' }]);
  const [location, setLocation] = useState(initialSlots.find((s) => s.location)?.location ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ message: json?.error?.message ?? 'Something went wrong.', severity: 'error' });
        return null;
      }
      return json.data;
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    const parsed = availabilitySchema.safeParse({ ranges, location: location || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the time ranges.');
      return;
    }
    setError(null);
    const data = await call(`/api/conferences/${eventId}/availability`, { method: 'PUT', body: JSON.stringify(parsed.data) });
    if (data) {
      setSlots(data.slots);
      showToast({ message: `${data.created} slot(s) created, ${data.kept} booked/blocked kept.`, severity: 'success' });
    }
  }

  async function toggleBlock(s: ConferenceSlotDto) {
    const data = await call(`/api/conference-slots/${s.id}`, { method: 'PATCH', body: JSON.stringify({ blocked: !s.blocked }) });
    if (data) setSlots((prev) => prev.map((x) => (x.id === s.id ? data : x)));
  }

  async function remove(s: ConferenceSlotDto) {
    const data = await call(`/api/conference-slots/${s.id}`, { method: 'DELETE' });
    if (data) setSlots((prev) => prev.filter((x) => x.id !== s.id));
  }

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
      <Paper variant="outlined" sx={{ p: 2, width: { xs: '100%', md: 360 } }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Time ranges
        </Typography>
        <Stack spacing={1.5}>
          {ranges.map((r, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                type="time"
                size="small"
                label="From"
                value={r.start}
                onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="time"
                size="small"
                label="To"
                value={r.end}
                onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <IconButton aria-label={`Remove range ${i + 1}`} onClick={() => setRanges(ranges.filter((_, j) => j !== i))} disabled={ranges.length === 1}>
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setRanges([...ranges, { start: '17:00', end: '18:00' }])} disabled={ranges.length >= MAX_RANGES}>
              Add range
            </Button>
          </Box>
          <TextField size="small" label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} slotProps={{ htmlInput: { maxLength: LOCATION_MAX } }} />
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" onClick={() => void regenerate()} disabled={busy}>
            Save availability
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ flexGrow: 1, width: '100%' }}>
        <Typography variant="subtitle1" sx={{ p: 2, pb: 0 }}>
          Your slots ({slots.length})
        </Typography>
        {slots.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            No slots yet. Add time ranges and save.
          </Typography>
        ) : (
          <List dense>
            {slots.map((s) => (
              <ListItem
                key={s.id}
                secondaryAction={
                  !s.booking && (
                    <>
                      <Tooltip title={s.blocked ? 'Unblock' : 'Block'}>
                        <IconButton aria-label={`${s.blocked ? 'Unblock' : 'Block'} ${time(s.startsAt)}`} onClick={() => void toggleBlock(s)} disabled={busy}>
                          {s.blocked ? <LockOpenIcon /> : <BlockIcon />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton aria-label={`Remove ${time(s.startsAt)}`} onClick={() => void remove(s)} disabled={busy}>
                          <DeleteOutlineIcon />
                        </IconButton>
                      </Tooltip>
                    </>
                  )
                }
              >
                <ListItemText
                  primary={`${time(s.startsAt)}–${time(s.endsAt)}${s.location ? ` · ${s.location}` : ''}`}
                  secondary={s.booking ? `${s.booking.student.firstName} ${s.booking.student.lastName} (${s.booking.parent.name})` : undefined}
                />
                {s.booking && <Chip size="small" color="primary" label="Booked" sx={{ mr: 1 }} />}
                {s.blocked && <Chip size="small" label="Blocked" sx={{ mr: 10 }} />}
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
