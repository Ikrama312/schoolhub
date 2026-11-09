'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useToast } from '@/components/Toast/useToast';
import { api } from './usePolling';

interface QuietHours {
  quietStart: string | null;
  quietEnd: string | null;
}

/**
 * PRD-13 FR-21: quiet hours (school timezone, may wrap midnight). Message emails that fall inside
 * them are held until they end; in-app notifications are unaffected. Native time inputs (ADR-6).
 */
export function QuietHoursSection({ initial, timezone }: { initial: QuietHours; timezone: string }) {
  const { showToast } = useToast();
  const [start, setStart] = useState(initial.quietStart ?? '');
  const [end, setEnd] = useState(initial.quietEnd ?? '');
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalid = (!start) !== (!end) ? 'Set both a start and an end time.' : start && start === end ? 'Start and end must differ.' : null;
  const dirty = start !== (saved.quietStart ?? '') || end !== (saved.quietEnd ?? '');

  async function save(value: QuietHours) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ data: QuietHours }>('/api/me/messaging-settings', { method: 'PUT', body: value });
      setSaved(data);
      setStart(data.quietStart ?? '');
      setEnd(data.quietEnd ?? '');
      showToast({ message: data.quietStart ? 'Quiet hours saved' : 'Quiet hours cleared', severity: 'success' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save quiet hours.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 3 }} component="section" aria-labelledby="quiet-hours-title">
      <Typography variant="h6" id="quiet-hours-title">
        Quiet hours
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Message emails are held until quiet hours end. Times are in the school timezone ({timezone}) and may run past midnight.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          type="time"
          label="Start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          size="small"
        />
        <TextField
          type="time"
          label="End"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          error={!!invalid && !!start && !!end}
          helperText={invalid ?? ' '}
          slotProps={{ inputLabel: { shrink: true } }}
          size="small"
        />
        <Button variant="contained" onClick={() => save({ quietStart: start || null, quietEnd: end || null })} disabled={!!invalid || !dirty || busy}>
          Save
        </Button>
        <Button onClick={() => save({ quietStart: null, quietEnd: null })} disabled={busy || (!saved.quietStart && !start && !end)}>
          Clear
        </Button>
      </Stack>
    </Paper>
  );
}
