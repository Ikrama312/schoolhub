'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import type { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import { formatMoney } from '@/lib/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PAYMENT_SORT_FIELDS } from '@/lib/validators/fees';
import type { PaymentRow } from '@/server/fees/reports';

const FILTERS = ['from', 'to', 'method', 'reversed', 'q'] as const;
const toLocalDate = (d: string) => new Date(`${d}T00:00:00`);

/** PRD-17 FR-32/FR-44: payments with a reversed chip; CSV over a date range (two DatePickers, ADR-11) and method. */
export function PaymentsTable({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, currency: 'USD' });
  const [loading, setLoading] = useState(true);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };
  const filterQuery = new URLSearchParams();
  for (const k of FILTERS) {
    const v = searchParams.get(k);
    if (v && k !== 'q') filterQuery.set(k, v);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    for (const k of [...FILTERS, 'page', 'pageSize', 'order']) {
      const v = searchParams.get(k);
      if (v) q.set(k, v);
    }
    const sort = searchParams.get('sort');
    if (sort && (PAYMENT_SORT_FIELDS as readonly string[]).includes(sort)) q.set('sort', sort);
    try {
      const res = await fetch(`/api/fees/payments?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      setRows(json.data);
      setMeta(json.meta);
    } catch (e) {
      showToast({ message: (e as Error).message || 'Could not load payments.', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: GridColDef[] = [
    {
      field: 'receiptNumber',
      headerName: 'Receipt',
      width: 170,
      renderCell: ({ row }) => (
        <MuiLink component={Link} href={`/admin/fees/payments/${row.id}`}>
          {row.receiptNumber}
        </MuiLink>
      ),
    },
    { field: 'receivedAt', headerName: 'Received', width: 160, valueFormatter: (v: string) => new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) },
    { field: 'payerName', headerName: 'Payer', flex: 1, minWidth: 150, sortable: false },
    { field: 'studentNames', headerName: 'Students', flex: 1, minWidth: 150, sortable: false, valueGetter: (v: string[]) => v.join(', ') },
    { field: 'method', headerName: 'Method', width: 130, sortable: false, valueFormatter: (v: keyof typeof PAYMENT_METHOD_LABELS) => PAYMENT_METHOD_LABELS[v] },
    { field: 'amount', headerName: 'Amount', width: 120, align: 'right', headerAlign: 'right', valueFormatter: (v: string) => formatMoney(v, meta.currency) },
    {
      field: 'reversed',
      headerName: 'Status',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (row.reversed ? <Chip size="small" color="error" variant="outlined" label="Reversed" /> : <Chip size="small" color="success" label="Received" />),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1.5 }}>
        <DatePicker
          label="From"
          value={searchParams.get('from') ? toLocalDate(searchParams.get('from')!) : null}
          onChange={(d) => setParam('from', d && !Number.isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : '')}
          slotProps={{ textField: { size: 'small', sx: { width: 170 } }, field: { clearable: true } }}
        />
        <DatePicker
          label="To"
          value={searchParams.get('to') ? toLocalDate(searchParams.get('to')!) : null}
          onChange={(d) => setParam('to', d && !Number.isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : '')}
          slotProps={{ textField: { size: 'small', sx: { width: 170 } }, field: { clearable: true } }}
        />
        <TextField select size="small" label="Method" sx={{ minWidth: 150 }} value={searchParams.get('method') ?? ''} onChange={(e) => setParam('method', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          {PAYMENT_METHODS.map((m) => (
            <MenuItem key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Status" sx={{ minWidth: 140 }} value={searchParams.get('reversed') ?? ''} onChange={(e) => setParam('reversed', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="false">Received</MenuItem>
          <MenuItem value="true">Reversed</MenuItem>
        </TextField>
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          <Button startIcon={<DownloadOutlinedIcon />} href={`/api/fees/export/payments?${filterQuery}`}>
            Export CSV
          </Button>
          {canWrite && (
            <Button variant="contained" startIcon={<AddIcon />} component={Link} href="/admin/fees/payments/new">
              Record payment
            </Button>
          )}
        </Stack>
      </Stack>
      <DataTable columns={columns} rows={rows} total={meta.total} loading={loading} />
    </Stack>
  );
}
