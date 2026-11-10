'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import { ABSENCE_REASON_LABELS, ABSENCE_STATUSES, REVIEW_NOTE_MAX } from '@/lib/validators/absence-notes';
import type { AbsenceNoteDto } from '@/server/absence-notes/absence-notes-service';

type Detail = AbsenceNoteDto & {
  attendanceRecords?: { id: string; date: string; periodName: string | null; status: string; note: string | null }[];
};

const STATUS_COLOR = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' } as const;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const dates = (n: { fromDate: string; toDate: string }) => (n.fromDate === n.toDate ? n.fromDate : `${n.fromDate} – ${n.toDate}`);
const SORTABLE = ['createdAt', 'fromDate'];

/** FR-21/FR-22: filterable queue + review dialog. 409 (already reviewed) → toast + refetch. */
export function AbsenceNotesReviewClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<AbsenceNoteDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = searchParams.get('status') ?? 'PENDING';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    for (const k of ['page', 'pageSize', 'q', 'from', 'to']) {
      const v = searchParams.get(k);
      if (v) q.set(k, v);
    }
    if (status !== 'ALL') q.set('status', status);
    const sort = searchParams.get('sort');
    if (sort && SORTABLE.includes(sort)) q.set('sort', `${sort}:${searchParams.get('order') ?? 'desc'}`);
    try {
      const res = await fetch(`/api/absence-notes?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      setRows(json.data);
      setTotal(json.meta.total);
    } catch (e) {
      showToast({ message: (e as Error).message || 'Could not load absence notes.', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchParams, status, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setReviewNote('');
    setNoteError(null);
    const res = await fetch(`/api/absence-notes/${id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast({ message: json?.error?.message ?? 'Could not open the note.', severity: 'error' });
      return;
    }
    setDetail(json.data);
  }

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!detail) return;
    if (decision === 'REJECTED' && !reviewNote.trim()) {
      setNoteError('A note is required when rejecting');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/absence-notes/${detail.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewNote: reviewNote.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ message: json?.error?.message ?? 'Could not save the review.', severity: 'error' });
        if (res.status === 409) {
          setDetail(null);
          void load();
        }
        return;
      }
      const { recordsExcused, recordsCreated } = json.data;
      showToast({
        message: decision === 'APPROVED' ? `Approved. ${recordsExcused + recordsCreated} attendance record(s) marked excused.` : 'Note rejected.',
        severity: 'success',
      });
      setDetail(null);
      void load();
    } finally {
      setBusy(false);
    }
  }

  const columns: GridColDef[] = [
    { field: 'student', headerName: 'Student', flex: 1, sortable: false, valueGetter: (_v, r) => `${r.student.firstName} ${r.student.lastName}` },
    { field: 'section', headerName: 'Section', width: 100, sortable: false, valueGetter: (_v, r) => r.student.sectionName ?? '' },
    { field: 'fromDate', headerName: 'Dates', width: 200, valueGetter: (_v, r) => dates(r) },
    { field: 'periods', headerName: 'Periods', width: 150, sortable: false, valueGetter: (_v, r) => (r.partialDay ? r.periods.map((p: { name: string }) => p.name).join(', ') : 'Whole day') },
    { field: 'reason', headerName: 'Reason', width: 170, sortable: false, valueGetter: (_v, r) => ABSENCE_REASON_LABELS[r.reason as keyof typeof ABSENCE_REASON_LABELS] },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      sortable: false,
      renderCell: (p) => <Chip size="small" color={STATUS_COLOR[p.row.status as keyof typeof STATUS_COLOR]} label={label(p.row.status)} />,
    },
    { field: 'createdAt', headerName: 'Received', width: 170, valueGetter: (_v, r) => new Date(r.createdAt).toLocaleString() },
    {
      field: 'actions',
      headerName: '',
      width: 110,
      sortable: false,
      renderCell: (p) => (
        <Button size="small" onClick={() => void open(p.row.id)}>
          {p.row.status === 'PENDING' ? 'Review' : 'View'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField select size="small" label="Status" value={status} onChange={(e) => setParam('status', e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="ALL">All</MenuItem>
          {ABSENCE_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {label(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setParam('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setParam('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>

      <DataTable columns={columns} rows={rows as unknown as Record<string, unknown>[]} total={total} loading={loading} />

      <Dialog open={detail !== null} onClose={() => !busy && setDetail(null)} fullWidth maxWidth="md">
        {detail && (
          <>
            <DialogTitle>
              {detail.student.firstName} {detail.student.lastName} — {dates(detail)}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography>
                  <strong>Reason:</strong> {ABSENCE_REASON_LABELS[detail.reason]} ·{' '}
                  {detail.partialDay ? `Periods: ${detail.periods.map((p) => p.name).join(', ')}` : 'Whole day'}
                </Typography>
                {detail.details && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detail.details}</Typography>}
                <Typography variant="body2" color="text.secondary">
                  Sent by {detail.submittedBy.name} on {new Date(detail.createdAt).toLocaleString()}
                </Typography>
                {detail.file && (
                  <Link href={detail.file.url} target="_blank" rel="noopener">
                    Document: {detail.file.name}
                  </Link>
                )}
                <Typography variant="subtitle2">Attendance already recorded for these dates</Typography>
                {detail.attendanceRecords?.length ? (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Period</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.attendanceRecords.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell>{r.periodName ?? 'Daily register'}</TableCell>
                          <TableCell>{label(r.status)}</TableCell>
                          <TableCell>{r.note ?? ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    None yet. Approving pre-fills future registers as excused.
                  </Typography>
                )}
                {detail.status === 'PENDING' ? (
                  <TextField
                    label="Note to parent"
                    multiline
                    minRows={2}
                    value={reviewNote}
                    onChange={(e) => {
                      setReviewNote(e.target.value);
                      setNoteError(null);
                    }}
                    error={!!noteError}
                    helperText={noteError ?? 'Optional when approving, required when rejecting.'}
                    slotProps={{ htmlInput: { maxLength: REVIEW_NOTE_MAX } }}
                  />
                ) : (
                  <Alert severity={detail.status === 'APPROVED' ? 'success' : 'error'}>
                    {label(detail.status)} by {detail.reviewedBy?.name}
                    {detail.reviewNote ? `: ${detail.reviewNote}` : ''}
                  </Alert>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetail(null)} disabled={busy}>
                Close
              </Button>
              {detail.status === 'PENDING' && (
                <>
                  <Button color="error" onClick={() => void decide('REJECTED')} disabled={busy}>
                    Reject
                  </Button>
                  <Button variant="contained" onClick={() => void decide('APPROVED')} disabled={busy}>
                    Approve
                  </Button>
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
