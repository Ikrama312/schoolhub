'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import PrintIcon from '@mui/icons-material/Print';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { ReportCardDocument } from '@/components/report-cards/ReportCardDocument';
import { COMMENT_MAX } from '@/lib/validators/gradebook';
import type { ReportCardDto } from '@/server/report-cards/report-card-service';

/** FR-32 / FR-34: preview, comment fields per role (DRAFT only), ADMIN publish / unpublish with reason. */
export function ReportCardReviewClient({ initial }: { initial: ReportCardDto }) {
  const { showToast } = useToast();
  const [card, setCard] = useState(initial);
  const [homeroom, setHomeroom] = useState(initial.homeroomComment ?? '');
  const [principal, setPrincipal] = useState(initial.principalComment ?? '');
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [reason, setReason] = useState('');
  const p = card.permissions;
  const draft = card.status === 'DRAFT';

  const refresh = async () => {
    const res = await fetch(`/api/report-cards/${card.id}`);
    if (res.ok) setCard((await res.json()).data);
  };

  const send = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
    return json.data;
  };

  const saveComments = async () => {
    setSaving(true);
    try {
      const body = {
        ...(p.canEditHomeroomComment ? { homeroomComment: homeroom.trim() ? homeroom : null } : {}),
        ...(p.canEditPrincipalComment ? { principalComment: principal.trim() ? principal : null } : {}),
      };
      setCard(await send(`/api/report-cards/${card.id}`, 'PATCH', body));
      showToast({ message: 'Comments saved', severity: 'success' });
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const doPublish = async () => {
    setPublishOpen(false);
    try {
      await send('/api/report-cards/publish', 'POST', { ids: [card.id] });
      showToast({ message: 'Report card published', severity: 'success' });
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    }
    await refresh();
  };

  const doUnpublish = async () => {
    try {
      await send('/api/report-cards/unpublish', 'POST', { ids: [card.id], reason });
      setUnpublishOpen(false);
      setReason('');
      showToast({ message: 'Report card returned to draft', severity: 'success' });
      await refresh();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    }
  };

  const canSave = p.canEditHomeroomComment || p.canEditPrincipalComment;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Chip label={draft ? 'Draft' : 'Published'} color={draft ? 'warning' : 'success'} />
        <Stack direction="row" spacing={1} sx={{ flex: 1, justifyContent: 'flex-end' }}>
          <Button startIcon={<PrintIcon />} component={NextLink} href={`/report-cards/${card.id}/print`}>
            Print view
          </Button>
          {p.canPublish && draft && (
            <Button variant="contained" onClick={() => setPublishOpen(true)}>
              Publish
            </Button>
          )}
          {p.canPublish && !draft && (
            <Button variant="outlined" color="warning" onClick={() => setUnpublishOpen(true)}>
              Unpublish
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          {!draft && <Alert severity="info">Published cards are locked. Unpublish to edit comments.</Alert>}
          <TextField
            label="Homeroom teacher’s comment"
            value={homeroom}
            onChange={(e) => setHomeroom(e.target.value)}
            disabled={!p.canEditHomeroomComment}
            multiline
            minRows={3}
            helperText={`${homeroom.length} / ${COMMENT_MAX}`}
            slotProps={{ htmlInput: { maxLength: COMMENT_MAX } }}
          />
          <TextField
            label="Principal’s comment"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            disabled={!p.canEditPrincipalComment}
            multiline
            minRows={3}
            helperText={`${principal.length} / ${COMMENT_MAX}`}
            slotProps={{ htmlInput: { maxLength: COMMENT_MAX } }}
          />
          {canSave && (
            <Stack direction="row">
              <Button variant="contained" onClick={saveComments} disabled={saving}>
                Save comments
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      <ReportCardDocument snapshot={card.snapshot} homeroomComment={card.homeroomComment} principalComment={card.principalComment} draft={draft} />

      <ConfirmDialog
        open={publishOpen}
        title="Publish this report card?"
        description="The student and their parents will be notified and can open the card."
        confirmLabel="Publish"
        onConfirm={doPublish}
        onCancel={() => setPublishOpen(false)}
      />
      <Dialog open={unpublishOpen} onClose={() => setUnpublishOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Unpublish report card</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>The card returns to draft and is hidden from the family. The reason is recorded in the audit log.</DialogContentText>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnpublishOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={!reason.trim()} onClick={doUnpublish}>
            Unpublish
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
