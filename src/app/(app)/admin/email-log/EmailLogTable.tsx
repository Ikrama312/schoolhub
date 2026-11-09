'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import { DataTable } from '@/components/DataTable/DataTable';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { EMAIL_STATUSES, type EmailStatusValue } from '@/lib/validators/notifications';

interface EmailLogRow {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  status: EmailStatusValue;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<EmailStatusValue, 'default' | 'info' | 'success' | 'error'> = {
  PENDING: 'default',
  SENDING: 'info',
  SENT: 'success',
  FAILED: 'error',
};

async function send(url: string, method = 'GET') {
  const res = await fetch(url, { method, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json;
}

/** FR-31..33: outbox log with status filter, "Retry now" on FAILED rows, test-notification action. */
export function EmailLogTable({ timezone }: { timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const status = (searchParams.get('status') ?? '') as EmailStatusValue | '';

  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const key of ['page', 'pageSize', 'status']) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      const json = await send(`/api/admin/email-log?${params.toString()}`);
      setRows(json.data);
      setTotal(json.meta.total);
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('status', value);
    else next.delete('status');
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };

  const retry = async (row: EmailLogRow) => {
    try {
      await send(`/api/admin/email-log/${row.id}/retry`, 'POST');
      showToast({ message: `Email to ${row.toEmail} queued for retry`, severity: 'success' });
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    }
  };

  const sendTest = async () => {
    setSendingTest(true);
    try {
      await send('/api/admin/notifications/test', 'POST');
      showToast({ message: 'Test notification sent to you', severity: 'success' });
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setSendingTest(false);
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'createdAt',
      headerName: 'Created',
      width: 180,
      sortable: false,
      valueFormatter: (value: string) => formatInSchoolTz(value, 'MMM d, yyyy h:mm a', timezone),
    },
    {
      field: 'toEmail',
      headerName: 'Recipient',
      flex: 1,
      minWidth: 200,
      sortable: false,
      valueGetter: (_v, row: EmailLogRow) => (row.toName ? `${row.toName} <${row.toEmail}>` : row.toEmail),
    },
    { field: 'subject', headerName: 'Subject', flex: 1, minWidth: 200, sortable: false },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      sortable: false,
      renderCell: ({ row }) => <Chip size="small" label={row.status} color={STATUS_COLOR[row.status as EmailStatusValue]} />,
    },
    { field: 'attempts', headerName: 'Attempts', width: 100, sortable: false, type: 'number' },
    {
      field: 'lastError',
      headerName: 'Last error',
      flex: 1,
      minWidth: 180,
      sortable: false,
      renderCell: ({ row }) =>
        row.lastError ? (
          <Tooltip title={row.lastError}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row.lastError}
            </Box>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 120,
      sortable: false,
      renderCell: ({ row }) =>
        row.status === 'FAILED' ? (
          <Button size="small" onClick={() => void retry(row as EmailLogRow)}>
            Retry now
          </Button>
        ) : null,
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Email log"
        description="Outgoing email queue and delivery history."
        actions={
          <Button variant="contained" onClick={() => void sendTest()} disabled={sendingTest}>
            Send test notification to me
          </Button>
        }
      />
      <FormControl size="small" sx={{ minWidth: 180, mb: 2 }}>
        <InputLabel id="email-status-label">Status</InputLabel>
        <Select labelId="email-status-label" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <MenuItem value="">All statuses</MenuItem>
          {EMAIL_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <DataTable columns={columns} rows={rows as unknown as Record<string, unknown>[]} total={total} loading={loading} />
    </Box>
  );
}
