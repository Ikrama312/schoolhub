'use client';

import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';

export interface FileRef {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface FileUploadProps {
  /** File context sent to POST /api/files ('assignment', 'submission', …). */
  context: string;
  max: number;
  value: FileRef[];
  onChange: (files: FileRef[]) => void;
  label?: string;
  disabled?: boolean;
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Uploads each chosen file to POST /api/files (context field first, ADR-2) and reports the
 * resulting refs. Uploaded files stay unattached until the parent form saves (FR-9, FR-20).
 */
export function FileUpload({ context, max, value, onChange, label = 'Attach files', disabled }: FileUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const remaining = max - value.length - pending.length;

  async function upload(file: File): Promise<FileRef> {
    const body = new FormData();
    body.append('context', context);
    body.append('file', file);
    const res = await fetch('/api/files', { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `Could not upload ${file.name}.`);
    const d = json.data as { id: string; originalName: string; mimeType: string; sizeBytes: number };
    return { id: d.id, filename: d.originalName, mimeType: d.mimeType, size: d.sizeBytes };
  }

  async function onPick(list: FileList | null) {
    if (!list) return;
    setError(null);
    const files = Array.from(list).slice(0, Math.max(0, remaining));
    if (list.length > files.length) setError(`You can attach at most ${max} files.`);
    setPending((p) => [...p, ...files.map((f) => f.name)]);
    const results = await Promise.allSettled(files.map(upload));
    setPending((p) => p.filter((name) => !files.some((f) => f.name === name)));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : 'Upload failed.');
    if (ok.length) onChange([...value, ...ok]);
    if (input.current) input.current.value = '';
  }

  return (
    <Box>
      <input ref={input} type="file" multiple hidden onChange={(e) => void onPick(e.target.files)} aria-label={label} />
      <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => input.current?.click()} disabled={disabled || remaining <= 0}>
        {label}
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        {value.length} / {max}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <List dense>
        {value.map((f) => (
          <ListItem
            key={f.id}
            secondaryAction={
              <IconButton edge="end" aria-label={`Remove ${f.filename}`} onClick={() => onChange(value.filter((v) => v.id !== f.id))} disabled={disabled}>
                <CloseIcon />
              </IconButton>
            }
          >
            <ListItemText primary={f.filename} secondary={formatBytes(f.size)} />
          </ListItem>
        ))}
        {pending.map((name, i) => (
          <ListItem key={`${name}-${i}`}>
            <ListItemText primary={name} secondary={<LinearProgress aria-label={`Uploading ${name}`} />} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
