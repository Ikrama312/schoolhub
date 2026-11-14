'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import MuiLink from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import { InvoiceStatusChip, INVOICE_STATUS_LABELS } from '@/components/fees/InvoiceStatusChip';
import { formatMoney } from '@/lib/money';
import { INVOICE_STATUSES, INVOICE_SORT_FIELDS } from '@/lib/validators/fees';
import type { InvoiceRow } from '@/server/fees/reports';
import { ManualInvoiceDialog, type ManualInvoiceOptions } from './ManualInvoiceDialog';

type Option = { id: string; name: string };
const FILTERS = ['status', 'termId', 'gradeLevelId', 'sectionId', 'overdue', 'q'] as const;

/** PRD-17 FR-17/FR-18/FR-44: server-mode table, filter bar, filtered totals and CSV of the same filters. */
export function InvoicesTable({
  terms,
  grades,
  sections,
  canWrite,
  manualOptions,
}: {
  terms: Option[];
  grades: Option[];
  sections: Option[];
  canWrite: boolean;
  manualOptions: ManualInvoiceOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, currency: 'USD', totals: { billed: '0.00', paid: '0.00', outstanding: '0.00' } });
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);

  const filterQuery = new URLSearchParams();
  for (const k of FILTERS) {
    const v = searchParams.get(k);
    if (v) filterQuery.set(k, v);
  }

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
    for (const k of [...FILTERS, 'page', 'pageSize', 'order']) {
      const v = searchParams.get(k);
      if (v) q.set(k, v);
    }
    const sort = searchParams.get('sort');
    if (sort && (INVOICE_SORT_FIELDS as readonly string[]).includes(sort)) q.set('sort', sort);
    try {
      const res = await fetch(`/api/fees/invoices?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message);
      setRows(json.data);
      setMeta(json.meta);
    } catch (e) {
      showToast({ message: (e as Error).message || 'Could not load invoices.', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (v: string) => formatMoney(v, meta.currency);
  const columns: GridColDef[] = [
    {
      field: 'number',
      headerName: 'Number',
      width: 160,
      renderCell: ({ row }) => (
        <MuiLink component={Link} href={`/admin/fees/invoices/${row.id}`}>
          {row.number ?? 'Draft'}
        </MuiLink>
      ),
    },
    { field: 'studentName', headerName: 'Student', flex: 1, minWidth: 160 },
    { field: 'grade', headerName: 'Grade / section', width: 150, sortable: false, valueGetter: (_v, row) => [row.gradeLevelName, row.sectionName].filter(Boolean).join(' · ') },
    { field: 'termName', headerName: 'Term', width: 120, sortable: false, valueGetter: (v) => v ?? 'Annual' },
    { field: 'issueDate', headerName: 'Issued', width: 110 },
    { field: 'dueDate', headerName: 'Due', width: 110 },
    { field: 'total', headerName: 'Total', width: 120, align: 'right', headerAlign: 'right', valueFormatter: (v: string) => money(v) },
    { field: 'amountPaid', headerName: 'Paid', width: 120, align: 'right', headerAlign: 'right', sortable: false, valueFormatter: (v: string) => money(v) },
    { field: 'balance', headerName: 'Balance', width: 120, align: 'right', headerAlign: 'right', sortable: false, valueFormatter: (v: string) => money(v) },
    { field: 'status', headerName: 'Status', width: 140, sortable: false, renderCell: ({ row }) => <InvoiceStatusChip status={row.status} /> },
  ];

  const select = (key: (typeof FILTERS)[number], label: string, options: Option[]) => (
    <TextField select size="small" label={label} sx={{ minWidth: 150 }} value={searchParams.get(key) ?? ''} onChange={(e) => setParam(key, e.target.value)}>
      <MenuItem value="">All</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.name}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: 'center', rowGap: 1.5 }}>
        {select('status', 'Status', INVOICE_STATUSES.map((s) => ({ id: s, name: INVOICE_STATUS_LABELS[s] })))}
        {select('termId', 'Term', terms)}
        {select('gradeLevelId', 'Grade', grades)}
        {select('sectionId', 'Section', sections)}
        <FormControlLabel
          control={<Switch checked={searchParams.get('overdue') === 'true'} onChange={(e) => setParam('overdue', e.target.checked ? 'true' : '')} />}
          label="Overdue only"
        />
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          <Button startIcon={<DownloadOutlinedIcon />} href={`/api/fees/export/invoices?${filterQuery}`}>
            Export CSV
          </Button>
          {canWrite && (
            <>
              <Button component={Link} href="/admin/fees/invoices/generate">
                Generate
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setManualOpen(true)}>
                New manual invoice
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      <DataTable columns={columns} rows={rows} total={meta.total} loading={loading} />

      <Paper variant="outlined" sx={{ p: 2 }} aria-label="Totals for the filtered invoices">
        <Stack direction="row" spacing={4} sx={{ flexWrap: 'wrap' }}>
          <Typography>
            Billed: <strong>{money(meta.totals.billed)}</strong>
          </Typography>
          <Typography>
            Paid: <strong>{money(meta.totals.paid)}</strong>
          </Typography>
          <Typography>
            Outstanding: <strong>{money(meta.totals.outstanding)}</strong>
          </Typography>
        </Stack>
      </Paper>

      {canWrite && (
        <ManualInvoiceDialog
          open={manualOpen}
          onClose={() => setManualOpen(false)}
          options={manualOptions}
          onCreated={(id) => router.push(`/admin/fees/invoices/${id}`)}
        />
      )}
    </Stack>
  );
}
