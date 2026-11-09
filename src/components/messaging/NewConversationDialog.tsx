'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { FileUpload, type FileRef } from '@/components/FileUpload/FileUpload';
import { BODY_MAX, COUNTER_FROM, MAX_FILES, MAX_PARTICIPANTS, SUBJECT_MAX } from '@/lib/messaging/constants';
import { announceMessagingChange, api } from './usePolling';
import type { UserSummary } from './ConversationList';

type Option = UserSummary & { group: string };

export interface NewConversationDialogProps {
  open: boolean;
  onClose: () => void;
  /** Prefilled recipients (FR-16 "Message parents", FR-17 roster selection). */
  initialRecipients?: UserSummary[];
  /** Only offer contacts from groups whose label passes (FR-16 "Message teacher"). */
  groupFilter?: (label: string) => boolean;
  initialSubject?: string;
}

/**
 * PRD-13 FR-12: recipients come only from /api/messaging/contacts (contact rules, never UserPicker),
 * optional subject (≤120) and the first message. Navigates to the new thread on success.
 */
export function NewConversationDialog({ open, onClose, initialRecipients, groupFilter, initialSubject }: NewConversationDialogProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [recipients, setRecipients] = useState<UserSummary[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<FileRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecipients(initialRecipients ?? []);
    setSubject(initialSubject ?? '');
    setBody('');
    setFiles([]);
    setError(null);
    setInput('');
  }, [open, initialRecipients, initialSubject]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = input.trim() ? `?${new URLSearchParams({ q: input.trim().slice(0, 100) })}` : '';
        const { data } = await api<{ data: { groups: { label: string; contacts: UserSummary[] }[] } }>(`/api/messaging/contacts${params}`);
        if (!cancelled) {
          setOptions(data.groups.filter((g) => !groupFilter || groupFilter(g.label)).flatMap((g) => g.contacts.map((c) => ({ ...c, group: g.label }))));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load contacts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, input, groupFilter]);

  // A person can sit in several groups; the picker shows each group, selection is by id.
  const selectedOptions = useMemo(() => recipients.map((r) => ({ ...r, group: '' })), [recipients]);
  const tooMany = recipients.length > MAX_PARTICIPANTS - 1;
  const canSubmit = recipients.length > 0 && body.trim().length > 0 && body.length <= BODY_MAX && !tooMany && !sending;

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const { data } = await api<{ data: { conversation: { id: string } } }>('/api/conversations', {
        method: 'POST',
        body: { participantIds: recipients.map((r) => r.id), subject: subject.trim() || undefined, body, fileIds: files.map((f) => f.id) },
      });
      announceMessagingChange();
      onClose();
      router.push(`/messages/${data.conversation.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the conversation.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="new-conversation-title">
      <DialogTitle id="new-conversation-title">New message</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Autocomplete<Option, true>
            multiple
            options={options}
            value={selectedOptions}
            loading={loading}
            groupBy={(o) => o.group}
            getOptionLabel={(o) => o.name}
            getOptionKey={(o) => `${o.group}:${o.id}`}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            filterOptions={(x) => x}
            filterSelectedOptions
            onInputChange={(_, v, reason) => reason !== 'reset' && setInput(v)}
            onChange={(_, v) => setRecipients(v.filter((o, i) => v.findIndex((x) => x.id === o.id) === i).map(({ group: _g, ...u }) => u))}
            noOptionsText={input ? 'No one you can message matches' : 'No contacts'}
            renderInput={(params) => (
              <TextField
                {...params}
                label="To"
                autoFocus
                error={tooMany}
                helperText={tooMany ? `At most ${MAX_PARTICIPANTS - 1} recipients` : undefined}
              />
            )}
          />
          <TextField
            label="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            slotProps={{ htmlInput: { maxLength: SUBJECT_MAX } }}
          />
          <TextField
            label="Message"
            multiline
            minRows={4}
            maxRows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={body.length > BODY_MAX}
            helperText={body.length > COUNTER_FROM ? `${body.length} / ${BODY_MAX}` : undefined}
          />
          <FileUpload context="message" max={MAX_FILES} value={files} onChange={setFiles} disabled={sending} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit} loading={sending}>
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
