'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { REASON_MAX } from '@/lib/messaging/constants';
import { api } from './usePolling';
import type { UserSummary } from './ConversationList';
import { SafeguardingConversations, SafeguardingThreadView, type SafeguardingMessage } from './SafeguardingConversations';

type Status = 'OPEN' | 'REVIEWED' | 'DISMISSED';
interface Report {
  id: string;
  status: Status;
  reason: string;
  reporter: UserSummary;
  message: SafeguardingMessage;
  conversationId: string;
  reviewedBy: UserSummary | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}
interface ReportDetail {
  report: Report;
  before: SafeguardingMessage[];
  after: SafeguardingMessage[];
  participants: (UserSummary & { leftAt: string | null })[];
}

const STATUS_COLOR = { OPEN: 'warning', REVIEWED: 'success', DISMISSED: 'default' } as const;

/** /admin/safeguarding tabs (FR-23, FR-24). `?tab=conversations` selects the second tab; `?report=<id>` opens a report. */
export function SafeguardingTabs({ timezone }: { timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = search.get('tab') === 'conversations' ? 'conversations' : 'reports';
  return (
    <>
      <Tabs value={tab} onChange={(_, v) => router.replace(v === 'reports' ? pathname : `${pathname}?tab=${v}`)} sx={{ mb: 2 }}>
        <Tab value="reports" label="Reports" />
        <Tab value="conversations" label="Conversations" />
      </Tabs>
      {tab === 'reports' ? (
        <SafeguardingReports timezone={timezone} initialReportId={search.get('report')} />
      ) : (
        <SafeguardingConversations timezone={timezone} />
      )}
    </>
  );
}

/** PRD-13 FR-23: reports queue (OPEN first) with a detail drawer — context, participants, Mark reviewed (note) / Dismiss. */
export function SafeguardingReports({ timezone, initialReportId }: { timezone: string; initialReportId?: string | null }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<Status | ''>('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const [rows, setRows] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialReportId ?? null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(pagination.page + 1), pageSize: String(pagination.pageSize) });
    if (status) params.set('status', status);
    try {
      const res = await api<{ data: Report[]; meta: { total: number } }>(`/api/safeguarding/reports?${params}`);
      setRows(res.data);
      setTotal(res.meta.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [status, pagination]);

  useEffect(() => {
    void load();
  }, [load]);

  // Each open is a safeguarding view and is audited server-side.
  useEffect(() => {
    if (!openId) return;
    setDetail(null);
    setDetailError(null);
    setNote('');
    api<{ data: ReportDetail }>(`/api/safeguarding/reports/${openId}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setDetailError(e instanceof Error ? e.message : 'Could not load the report.'));
  }, [openId]);

  async function decide(action: 'review' | 'dismiss') {
    if (!openId) return;
    setBusy(true);
    try {
      const { data } = await api<{ data: { report: Report } }>(`/api/safeguarding/reports/${openId}`, {
        method: 'PATCH',
        body: { action, note: note.trim() || undefined },
      });
      setDetail((d) => (d ? { ...d, report: data.report } : d));
      showToast({ message: action === 'review' ? 'Report marked reviewed' : 'Report dismissed', severity: 'success' });
      void load();
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not update the report.', severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const columns: GridColDef<Report>[] = [
    { field: 'createdAt', headerName: 'Reported', width: 170, sortable: false, valueFormatter: (v: string) => formatInSchoolTz(v, 'd MMM yyyy, h:mm a', timezone) },
    { field: 'status', headerName: 'Status', width: 120, sortable: false, renderCell: ({ value }) => <Chip size="small" color={STATUS_COLOR[value as Status]} label={value} /> },
    { field: 'reporter', headerName: 'Reported by', width: 170, sortable: false, valueGetter: (_v, r) => r.reporter.name },
    { field: 'sender', headerName: 'Sender', width: 170, sortable: false, valueGetter: (_v, r) => r.message.sender.name },
    { field: 'reason', headerName: 'Reason', flex: 1, minWidth: 200, sortable: false },
  ];

  const report = detail?.report;
  const studentInvolved = detail?.participants.some((p) => p.role === 'STUDENT');

  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Status"
        size="small"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value as Status | '');
          setPagination((p) => ({ ...p, page: 0 }));
        }}
        sx={{ width: 200 }}
      >
        <MenuItem value="">All (open first)</MenuItem>
        <MenuItem value="OPEN">Open</MenuItem>
        <MenuItem value="REVIEWED">Reviewed</MenuItem>
        <MenuItem value="DISMISSED">Dismissed</MenuItem>
      </TextField>
      {error && <Alert severity="error">{error}</Alert>}
      <DataGrid
        rows={rows}
        columns={columns}
        rowCount={total}
        loading={loading}
        paginationMode="server"
        paginationModel={pagination}
        onPaginationModelChange={setPagination}
        pageSizeOptions={[20, 50, 100]}
        disableRowSelectionOnClick
        disableColumnMenu
        onRowClick={({ id }) => setOpenId(String(id))}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        autoHeight
      />

      <Drawer anchor="right" open={openId !== null} onClose={() => setOpenId(null)} slotProps={{ paper: { sx: { width: { xs: '100%', md: 640 } } } }}>
        <Stack direction="row" sx={{ alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Report
          </Typography>
          <IconButton aria-label="Close" onClick={() => setOpenId(null)}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          {detailError && <Alert severity="error">{detailError}</Alert>}
          {!detail && !detailError && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {report && detail && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" color={STATUS_COLOR[report.status]} label={report.status} />
                <Typography variant="body2">
                  Reported by <strong>{report.reporter.name}</strong> on {formatInSchoolTz(report.createdAt, 'd MMM yyyy, h:mm a', timezone)}
                </Typography>
              </Stack>
              <Alert severity="warning" icon={false}>
                <Typography variant="subtitle2">Reason</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {report.reason}
                </Typography>
              </Alert>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Participants
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {detail.participants.map((p) => (
                    <Chip key={p.id} size="small" variant="outlined" label={`${p.name} · ${p.role}${p.leftAt ? ' (left)' : ''}`} />
                  ))}
                </Stack>
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Context (5 messages either side)
                </Typography>
                <SafeguardingThreadView messages={[...detail.before, report.message, ...detail.after]} timezone={timezone} highlightId={report.message.id} />
              </Box>
              {studentInvolved && (
                <Button component={NextLink} href={`/admin/safeguarding/conversations/${report.conversationId}`} variant="text" sx={{ alignSelf: 'flex-start' }}>
                  Open full conversation
                </Button>
              )}
              {report.status === 'OPEN' ? (
                <Stack spacing={1}>
                  <TextField
                    label="Review note"
                    multiline
                    minRows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    helperText="Required to mark reviewed; optional when dismissing."
                    slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={() => decide('review')} disabled={busy || !note.trim()}>
                      Mark reviewed
                    </Button>
                    <Button onClick={() => decide('dismiss')} disabled={busy}>
                      Dismiss
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Alert severity="info">
                  {report.status === 'REVIEWED' ? 'Reviewed' : 'Dismissed'} by {report.reviewedBy?.name ?? 'unknown'}
                  {report.reviewedAt ? ` on ${formatInSchoolTz(report.reviewedAt, 'd MMM yyyy, h:mm a', timezone)}` : ''}
                  {report.reviewNote ? ` — ${report.reviewNote}` : ''}
                </Alert>
              )}
            </Stack>
          )}
        </Box>
      </Drawer>
    </Stack>
  );
}
