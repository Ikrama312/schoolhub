'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { formatMoney } from '@/lib/money';
import type { previewInvoices } from '@/server/fees/fees-service';

type Option = { id: string; name: string };
type Preview = Awaited<ReturnType<typeof previewInvoices>>;
const ANNUAL = 'annual';
const SKIP_LABEL = { ALREADY_INVOICED: 'Skipped — already invoiced', NO_PLAN: 'Skipped — no fee plan' } as const;

/** PRD-17 FR-12 to FR-14: choose term (or annual) and grades → preview → create drafts or create and issue. */
export function GenerateInvoices({ academicYearId, terms, grades }: { academicYearId: string; terms: Option[]; grades: Option[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [termId, setTermId] = useState(terms[0]?.id ?? ANNUAL);
  const [selected, setSelected] = useState<Option[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);

  const body = () => ({ academicYearId, termId: termId === ANNUAL ? null : termId, gradeLevelIds: selected.map((g) => g.id) });

  async function post<T>(url: string, payload: unknown): Promise<T> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed.');
    return json.data as T;
  }

  async function runPreview() {
    setBusy(true);
    try {
      setPreview(await post<Preview>('/api/fees/invoices/preview', body()));
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function generate(issue: boolean) {
    setBusy(true);
    try {
      const r = await post<{ created: number; issued: number; skipped: unknown[] }>('/api/fees/invoices/generate', { ...body(), issue });
      showToast({
        message: `${r.created} invoice${r.created === 1 ? '' : 's'} ${issue ? 'issued' : 'created as drafts'}; ${r.skipped.length} skipped.`,
        severity: 'success',
      });
      router.push(`/admin/fees/invoices${termId === ANNUAL ? '' : `?termId=${termId}`}`);
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
      setConfirmIssue(false);
    }
  }

  const money = (v: string) => formatMoney(v, preview?.currency ?? 'USD');

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <TextField
            select
            label="Term"
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              setPreview(null);
            }}
            sx={{ minWidth: 200 }}
          >
            {terms.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
            <MenuItem value={ANNUAL}>Annual (whole year)</MenuItem>
          </TextField>
          <Autocomplete
            multiple
            sx={{ minWidth: 320, flex: 1 }}
            options={grades}
            getOptionLabel={(g) => g.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            value={selected}
            onChange={(_e, v) => {
              setSelected(v);
              setPreview(null);
            }}
            renderInput={(params) => <TextField {...params} label="Grades" />}
          />
          <Button variant="outlined" onClick={runPreview} disabled={busy || selected.length === 0}>
            Preview
          </Button>
        </Stack>
      </Paper>

      {preview && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography>
              To create: <strong>{preview.summary.toCreate}</strong>
            </Typography>
            <Typography>
              Skipped: <strong>{preview.summary.skipped}</strong>
            </Typography>
            <Typography>
              Total: <strong>{money(preview.summary.total)}</strong>
            </Typography>
            <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
              <Button onClick={() => generate(false)} disabled={busy || preview.summary.toCreate === 0}>
                Create drafts
              </Button>
              <Button variant="contained" onClick={() => setConfirmIssue(true)} disabled={busy || preview.summary.toCreate === 0}>
                Create and issue
              </Button>
            </Stack>
          </Stack>
          {preview.rows.length === 0 ? (
            <Alert severity="info">No students in the selected grades.</Alert>
          ) : (
            <Table size="small" aria-label="Invoice preview">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell>Grade / section</TableCell>
                  <TableCell>Lines</TableCell>
                  <TableCell align="right">Subtotal</TableCell>
                  <TableCell align="right">Discounts</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.studentId} sx={r.skipped ? { '& td': { color: 'text.disabled' } } : undefined}>
                    <TableCell>{r.studentName}</TableCell>
                    <TableCell>{[r.gradeLevelName, r.sectionName].filter(Boolean).join(' · ')}</TableCell>
                    <TableCell>
                      {r.skipped ? (
                        <Chip size="small" label={SKIP_LABEL[r.skipped]} variant="outlined" />
                      ) : (
                        r.lines.map((l) => `${l.description} ${money(l.amount)}`).join(' · ')
                      )}
                    </TableCell>
                    <TableCell align="right">{r.skipped ? '—' : money(r.subtotal)}</TableCell>
                    <TableCell align="right">{r.skipped ? '—' : money(r.discountTotal)}</TableCell>
                    <TableCell align="right">{r.skipped ? '—' : money(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      <ConfirmDialog
        open={confirmIssue}
        title="Create and issue invoices?"
        description={`${preview?.summary.toCreate ?? 0} invoices will get numbers and parents will be notified. Issued invoices can only be voided, not deleted.`}
        confirmLabel="Create and issue"
        onConfirm={() => generate(true)}
        onCancel={() => setConfirmIssue(false)}
      />
    </Stack>
  );
}
