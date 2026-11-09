'use client';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { formatBytes, type FileRef } from '@/components/FileUpload/FileUpload';

/**
 * Download links to /api/files/:id (access enforced there). With `preview`, images render
 * inline and PDFs in a same-origin iframe via ?inline=1 (FR-29, D11).
 */
export function FileList({ files, preview = false }: { files: FileRef[]; preview?: boolean }) {
  if (files.length === 0) return null;
  return (
    <List dense>
      {files.map((f) => (
        <ListItem key={f.id} sx={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <InsertDriveFileOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={
                <Link href={`/api/files/${f.id}`} underline="hover">
                  {f.filename}
                </Link>
              }
              secondary={formatBytes(f.size)}
            />
          </Box>
          {preview && f.mimeType.startsWith('image/') && (
            <Box component="img" src={`/api/files/${f.id}?inline=1`} alt={f.filename} sx={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain', mt: 1 }} />
          )}
          {preview && f.mimeType === 'application/pdf' && (
            <Box component="iframe" src={`/api/files/${f.id}?inline=1`} title={f.filename} sx={{ width: '100%', height: 560, border: 1, borderColor: 'divider', mt: 1 }} />
          )}
        </ListItem>
      ))}
    </List>
  );
}
