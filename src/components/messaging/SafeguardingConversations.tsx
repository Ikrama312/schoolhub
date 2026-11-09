'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { FileList } from '@/components/FileList/FileList';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import { api } from './usePolling';
import type { UserSummary } from './ConversationList';

export interface SafeguardingMessage {
  id: string;
  sender: UserSummary;
  body: string;
  deleted: boolean;
  deletedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  attachments: { fileId: string; name: string; mimeType: string; size: number }[];
  revisions: { body: string; createdAt: string }[];
}

/**
 * PRD-13 FR-24/NFR-3: read-only messages for safeguarding leads — deleted content is shown and
 * marked, and every earlier version of an edited message is listed. `highlightId` marks a reported message.
 */
export function SafeguardingThreadView({ messages, timezone, highlightId }: { messages: SafeguardingMessage[]; timezone: string; highlightId?: string }) {
  if (!messages.length) return <EmptyState title="No messages" />;
  let lastDay = '';
  return (
    <Stack spacing={1}>
      {messages.map((m) => {
        const day = formatInSchoolTz(m.createdAt, 'yyyy-MM-dd', timezone);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <Fragment key={m.id}>
            {showDay && (
              <Divider>
                <Typography variant="caption" color="text.secondary">
                  {formatInSchoolTz(m.createdAt, 'EEEE d MMMM yyyy', timezone)}
                </Typography>
              </Divider>
            )}
            <Paper
              variant="outlined"
              sx={{ p: 1.5, borderColor: m.id === highlightId ? 'warning.main' : undefined, borderWidth: m.id === highlightId ? 2 : 1 }}
            >
              <Stack direction="row" spacing={1.5}>
                <UserAvatar userId={m.sender.id} name={m.sender.name} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2">{m.sender.name}</Typography>
                    <Chip size="small" variant="outlined" label={m.sender.role} />
                    <Typography variant="caption" color="text.secondary">
                      {formatInSchoolTz(m.createdAt, 'd MMM yyyy, h:mm a', timezone)}
                    </Typography>
                    {m.id === highlightId && <Chip size="small" color="warning" label="Reported" />}
                    {m.deleted && (
                      <Chip
                        size="small"
                        color="error"
                        label={`Deleted ${m.deletedAt ? formatInSchoolTz(m.deletedAt, 'd MMM, h:mm a', timezone) : ''}`}
                      />
                    )}
                    {m.editedAt && <Chip size="small" label="Edited" />}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5, ...(m.deleted ? { color: 'text.secondary' } : {}) }}
                  >
                    {m.body}
                  </Typography>
                  <FileList files={m.attachments.map((a) => ({ id: a.fileId, filename: a.name, mimeType: a.mimeType, size: a.size }))} />
                  {m.revisions.length > 0 && (
                    <Box sx={{ mt: 1, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
                      <Typography variant="caption" color="text.secondary">
                        Earlier versions
                      </Typography>
                      {m.revisions.map((r, i) => (
                        <Typography key={i} variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          <Typography component="span" variant="caption">
                            {formatInSchoolTz(r.createdAt, 'd MMM, h:mm a', timezone)}:{' '}
                          </Typography>
                          {r.body}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              </Stack>
            </Paper>
          </Fragment>
        );
      })}
    </Stack>
  );
}

interface Row {
  id: string;
  subject: string | null;
  participants: UserSummary[];
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  openReportCount: number;
}

/** PRD-13 FR-24: search conversations that involve a student, by participant and date. Opening one is audited. */
export function SafeguardingConversations({ timezone }: { timezone: string }) {
  const router = useRouter();
  const [participant, setParticipant] = useState<UserPickerOption | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(pagination.page + 1), pageSize: String(pagination.pageSize) });
    if (participant) params.set('participantId', participant.id);
    if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
    try {
      const res = await api<{ data: Row[]; meta: { total: number } }>(`/api/safeguarding/conversations?${params}`);
      setRows(res.data);
      setTotal(res.meta.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, [participant, from, to, pagination]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: GridColDef<Row>[] = [
    { field: 'subject', headerName: 'Subject', flex: 1, minWidth: 160, sortable: false, valueGetter: (_v, r) => r.subject ?? '—' },
    { field: 'participants', headerName: 'Participants', flex: 2, minWidth: 220, sortable: false, valueGetter: (_v, r) => r.participants.map((p) => p.name).join(', ') },
    { field: 'lastMessageAt', headerName: 'Last message', width: 170, sortable: false, valueFormatter: (v: string) => formatInSchoolTz(v, 'd MMM yyyy, h:mm a', timezone) },
    { field: 'messageCount', headerName: 'Messages', width: 100, sortable: false },
    {
      field: 'openReportCount',
      headerName: 'Open reports',
      width: 120,
      sortable: false,
      renderCell: ({ value }) => (value ? <Chip size="small" color="warning" label={value} /> : '—'),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <UserPicker
            label="Participant"
            value={participant}
            onChange={(v) => {
              setParticipant(v as UserPickerOption | null);
              setPagination((p) => ({ ...p, page: 0 }));
            }}
          />
        </Box>
        <TextField type="date" label="Active from" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="date" label="Active to" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="body2" color="text.secondary">
        Only conversations that include a student are listed. Opening a conversation is recorded in the audit log.
      </Typography>
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
        onRowClick={({ id }) => router.push(`/admin/safeguarding/conversations/${id}`)}
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        autoHeight
      />
    </Stack>
  );
}
