'use client';

import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';

export interface MarkdownEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  minRows?: number;
  error?: string;
  disabled?: boolean;
}

/** Controlled Markdown input with a Write / Preview toggle (FR-9, FR-20, FR-30). */
export function MarkdownEditor({ label, value, onChange, maxLength, minRows = 6, error, disabled }: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const id = useId();
  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} aria-label={`${label} editor mode`} sx={{ minHeight: 36 }}>
        <Tab value="write" label="Write" id={`${id}-write`} sx={{ minHeight: 36 }} />
        <Tab value="preview" label="Preview" id={`${id}-preview`} sx={{ minHeight: 36 }} />
      </Tabs>
      {tab === 'write' ? (
        <TextField
          label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          multiline
          minRows={minRows}
          fullWidth
          disabled={disabled}
          error={!!error}
          helperText={error ?? (maxLength ? `${value.length.toLocaleString()} / ${maxLength.toLocaleString()} · Markdown supported` : 'Markdown supported')}
          slotProps={{ htmlInput: { maxLength } }}
          sx={{ mt: 1 }}
        />
      ) : (
        <Paper variant="outlined" sx={{ mt: 1, p: 2, minHeight: minRows * 24 }} aria-labelledby={`${id}-preview`}>
          {value.trim() ? <MarkdownView source={value} /> : <Typography color="text.secondary">Nothing to preview.</Typography>}
        </Paper>
      )}
    </Box>
  );
}
