'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import NextLink from 'next/link';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import PublishIcon from '@mui/icons-material/Publish';
import PrintIcon from '@mui/icons-material/Print';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import type { RosterRow } from '@/server/report-cards/report-card-service';

const STATUS = {
  NOT_GENERATED: { label: 'Not generated', color: 'default' },
  DRAFT: { label: 'Draft', color: 'warning' },
  PUBLISHED: { label: 'Published', color: 'success' },
} as const;

type Confirm = 'generate' | 'publish' | null;

export function ReportCardsAdminClient({
  terms,
  gradeLevels,
  sections,
  defaultTermId,
}: {
  terms: { id: string; name: string; academicYearId: string }[];
  gradeLevels: { id: string; name: string }[];
  sections: { id: string; name: string; academicYearId: string; gradeLevelId: string }[];
  defaultTermId: string;
}) {
  const { showToast } = useToast();
  const [termId, setTermId] = useState(defaultTermId);
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const yearId = terms.find((t) => t.id === termId)?.academicYearId;
  const sectionOptions = sections.filter((s) => s.academicYearId === yearId && (!gradeLevelId || s.gradeLevelId === gradeLevelId));
  const query = useMemo(() => new URLSearchParams({ termId, ...(gradeLevelId ? { gradeLevelId } : {}), ...(sectionId ? { sectionId } : {}) }).toString(), [termId, gradeLevelId, sectionId]);

  const load = useCallback(async () => {
    if (!termId) return;
    setLoading(true);
    const res = await fetch(`/api/report-cards?${query}`);
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not load report cards.', severity: 'error' });
    setRows(json.data);
  }, [query, termId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const drafts = rows.filter((r) => r.status === 'DRAFT').map((r) => r.reportCard!.id);
  const published = rows.filter((r) => r.status === 'PUBLISHED').length;

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
    return json.data;
  };

  const run = async () => {
    const action = confirm;
    setConfirm(null);
    try {
      if (action === 'generate') {
        const r = await post('/api/report-cards/generate', { termId, studentIds: rows.map((x) => x.student.id) });
        showToast({ message: `${r.created} created, ${r.refreshed} refreshed, ${r.skippedPublished} published left unchanged`, severity: 'success' });
      } else if (action === 'publish') {
        const r = await post('/api/report-cards/publish', { ids: drafts });
        showToast({ message: `${r.publishedIds.length} report card${r.publishedIds.length === 1 ? '' : 's'} published`, severity: 'success' });
      }
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Request failed', severity: 'error' });
    }
    await load();
  };

  const columns: GridColDef<RosterRow & { id: string }>[] = [
    {
      field: 'name',
      headerName: 'Student',
      flex: 1,
      minWidth: 180,
      valueGetter: (_v, r) => `${r.student.lastName}, ${r.student.firstName}`,
      renderCell: ({ row, value }) =>
        row.reportCard ? (
          <Link component={NextLink} href={`/report-cards/${row.reportCard.id}`}>
            {value as string}
          </Link>
        ) : (
          (value as string)
        ),
    },
    { field: 'admission', headerName: 'Admission no.', width: 130, valueGetter: (_v, r) => r.student.admissionNumber ?? '' },
    { field: 'section', headerName: 'Section', width: 110, valueGetter: (_v, r) => r.student.section.name },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: ({ row }) => <Chip size="small" label={STATUS[row.status].label} color={STATUS[row.status].color} variant={row.status === 'NOT_GENERATED' ? 'outlined' : 'filled'} />,
    },
    {
      field: 'warnings',
      headerName: 'Warnings',
      flex: 2,
      minWidth: 260,
      sortable: false,
      valueGetter: (_v, r) => r.warningText.join('; '),
      renderCell: ({ value }) => (
        <Typography variant="body2" color={value ? 'warning.main' : 'text.secondary'} noWrap title={value as string}>
          {(value as string) || '—'}
        </Typography>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <TextField select size="small" label="Term" value={termId} onChange={(e) => (setTermId(e.target.value), setSectionId(''))} sx={{ minWidth: 240 }}>
          {terms.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Grade level" value={gradeLevelId} onChange={(e) => (setGradeLevelId(e.target.value), setSectionId(''))} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {gradeLevels.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {sectionOptions.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="contained" startIcon={<AutorenewIcon />} disabled={!rows.length} onClick={() => setConfirm('generate')}>
          Generate drafts ({rows.length})
        </Button>
        <Button variant="outlined" startIcon={<PublishIcon />} disabled={!drafts.length} onClick={() => setConfirm('publish')}>
          Publish all ({drafts.length})
        </Button>
        <Button startIcon={<PrintIcon />} disabled={!published} component={NextLink} href={`/report-cards/print?${query}`}>
          Print all ({published})
        </Button>
      </Stack>
      {!termId && <Alert severity="info">Create academic year terms first.</Alert>}
      <DataGrid
        autoHeight
        rows={rows.map((r) => ({ ...r, id: r.student.id }))}
        columns={columns}
        loading={loading}
        disableRowSelectionOnClick
        initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
        pageSizeOptions={[25, 50, 100]}
      />
      <ConfirmDialog
        open={confirm === 'generate'}
        title="Generate draft report cards?"
        description={`Builds or refreshes drafts for ${rows.length} student(s). Published cards are never changed; comments on drafts are kept.`}
        confirmLabel="Generate"
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'publish'}
        title="Publish report cards?"
        description={`${drafts.length} draft card(s) will be published and students and parents notified.`}
        confirmLabel="Publish"
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </Stack>
  );
}
