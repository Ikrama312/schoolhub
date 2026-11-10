'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import { TRACKING_STATUSES } from '@/lib/validators/consent-forms';
import type { TrackingRow } from '@/server/consent-forms/consent-forms-service';

const STATUS = { GRANTED: { label: 'Granted', color: 'success' }, DECLINED: { label: 'Declined', color: 'error' }, NO_RESPONSE: { label: 'No response', color: 'default' } } as const;
const SORTABLE = ['studentName', 'status', 'respondedAt'];

/** FR-39: per-student status with filter, CSV export and a throttled "Remind non-responders". */
export function ConsentTrackingClient({ formId, pastDue, lastRemindedAt }: { formId: string; pastDue: boolean; lastRemindedAt: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ granted: 0, declined: 0, noResponse: 0 });
  const [loading, setLoading] = useState(true);
  const [reminded, setReminded] = useState(lastRemindedAt);
  const [busy, setBusy] = useState(false);
  const status = searchParams.get('status') ?? '';

  const query = useCallback(() => {
    const q = new URLSearchParams();
    for (const k of ['page', 'pageSize', 'q', 'status']) if (searchParams.get(k)) q.set(k, searchParams.get(k)!);
    const sort = searchParams.get('sort');
    if (sort && SORTABLE.includes(sort)) q.set('sort', `${sort}:${searchParams.get('order') ?? 'asc'}`);
    return q;
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/consent-forms/${formId}/tracking?${query()}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setRows(json.data);
      setTotal(json.meta.total);
      setCounts(json.meta.counts);
    } else showToast({ message: json?.error?.message ?? 'Could not load responses.', severity: 'error' });
    setLoading(false);
  }, [formId, query, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remind() {
    setBusy(true);
    try {
      const res = await fetch(`/api/consent-forms/${formId}/remind`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const ms = json?.error?.details?.retryAfterMs;
        const hours = typeof ms === 'number' ? Math.ceil(ms / 3_600_000) : null;
        showToast({ message: res.status === 429 && hours ? `Reminders were sent recently. Try again in about ${hours} hour(s).` : (json?.error?.message ?? 'Could not send reminders.'), severity: 'warning' });
        return;
      }
      setReminded(json.data.remindedAt);
      showToast({ message: `Reminder sent to ${json.data.notifiedParents} parent(s)`, severity: 'success' });
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (v: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (v) next.set('status', v);
    else next.delete('status');
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };

  const csvQuery = new URLSearchParams(query());
  csvQuery.delete('page');
  csvQuery.delete('pageSize');
  csvQuery.set('format', 'csv');

  const columns: GridColDef[] = [
    { field: 'studentName', headerName: 'Student', flex: 1, valueGetter: (_v, r) => `${r.student.firstName} ${r.student.lastName}` },
    { field: 'section', headerName: 'Section', width: 100, sortable: false, valueGetter: (_v, r) => r.student.sectionName ?? '' },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (p) => {
        const s = STATUS[p.row.status as keyof typeof STATUS];
        return <Chip size="small" color={s.color} label={s.label} />;
      },
    },
    { field: 'respondedBy', headerName: 'Responded by', width: 170, sortable: false, valueGetter: (_v, r) => r.respondedBy?.name ?? '' },
    { field: 'respondedAt', headerName: 'Responded at', width: 180, valueGetter: (_v, r) => (r.respondedAt ? new Date(r.respondedAt).toLocaleString() : '') },
    { field: 'comment', headerName: 'Comment', flex: 1, sortable: false },
  ];

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <Stack direction="row" spacing={1}>
          <Chip color="success" variant="outlined" label={`Granted ${counts.granted}`} />
          <Chip color="error" variant="outlined" label={`Declined ${counts.declined}`} />
          <Chip variant="outlined" label={`No response ${counts.noResponse}`} />
        </Stack>
        <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {TRACKING_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {STATUS[s].label}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1} sx={{ flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          {reminded && (
            <Typography variant="body2" color="text.secondary" suppressHydrationWarning>
              Last reminded {new Date(reminded).toLocaleString()}
            </Typography>
          )}
          <Button variant="outlined" startIcon={<DownloadIcon />} href={`/api/consent-forms/${formId}/tracking?${csvQuery}`}>
            Export CSV
          </Button>
          <Button variant="contained" startIcon={<NotificationsActiveOutlinedIcon />} onClick={() => void remind()} disabled={busy || pastDue || counts.noResponse === 0}>
            Remind non-responders
          </Button>
        </Stack>
      </Stack>
      <DataTable columns={columns} rows={rows as unknown as Record<string, unknown>[]} total={total} loading={loading} getRowId={(r) => (r.student as { id: string }).id} />
    </>
  );
}
