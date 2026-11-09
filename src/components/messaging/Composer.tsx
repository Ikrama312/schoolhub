'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';
import { FileUpload, type FileRef } from '@/components/FileUpload/FileUpload';
import { BODY_MAX, COUNTER_FROM, MAX_FILES } from '@/lib/messaging/constants';
import { api } from './usePolling';
import type { MessageDTO } from './MessageThread';

export const CANNOT_SEND = 'You can no longer send messages in this conversation.';

/**
 * PRD-13 FR-11: Enter sends, Shift+Enter adds a newline; up to 5 attachments (context 'message');
 * a counter appears past 4,500 characters. Disabled with an explanation when canSend is false (FR-7).
 */
export function Composer({ conversationId, canSend, onSent }: { conversationId: string; canSend: boolean; onSent: (m: MessageDTO) => void }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<FileRef[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  if (!canSend || blocked) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">{CANNOT_SEND}</Alert>
      </Box>
    );
  }

  const tooLong = body.length > BODY_MAX;
  const ready = body.trim().length > 0 && !tooLong && !sending;

  async function send() {
    if (!ready) return;
    setSending(true);
    setError(null);
    try {
      const { data } = await api<{ data: { message: MessageDTO } }>(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { body, fileIds: files.map((f) => f.id) },
      });
      setBody('');
      setFiles([]);
      onSent(data.message);
    } catch (e) {
      const err = e as { details?: { reason?: string }; message?: string };
      if (err.details?.reason === 'RELATIONSHIP_ENDED') setBlocked(true);
      else setError(err.message ?? 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={8}
          size="small"
          placeholder="Write a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          error={tooLong}
          disabled={sending}
          slotProps={{ htmlInput: { 'aria-label': 'Message' } }}
        />
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton color="primary" onClick={() => void send()} disabled={!ready} aria-label="Send message">
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <FileUpload context="message" max={MAX_FILES} value={files} onChange={setFiles} disabled={sending} />
        {body.length > COUNTER_FROM && (
          <Typography variant="caption" color={tooLong ? 'error' : 'text.secondary'} sx={{ pt: 1 }} aria-live="polite">
            {body.length} / {BODY_MAX}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
