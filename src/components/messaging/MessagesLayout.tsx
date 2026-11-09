'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

/**
 * PRD-13 FR-9/NFR-7: list on the left, thread on the right. Below 768 px only one pane shows —
 * the list on /messages, the thread (with a back button) on /messages/[id].
 */
export function MessagesLayout({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down(768));
  const inThread = pathname !== '/messages';

  return (
    <Paper variant="outlined" sx={{ display: 'flex', height: 'calc(100vh - 64px - 48px)', minHeight: 420, overflow: 'hidden' }}>
      {(!narrow || !inThread) && (
        <Box sx={{ width: narrow ? '100%' : 340, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</Box>
      )}
      {!narrow && <Divider orientation="vertical" flexItem />}
      {(!narrow || inThread) && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {narrow && (
            <Box sx={{ px: 1, pt: 1 }}>
              <IconButton component={NextLink} href="/messages" aria-label="Back to conversations">
                <ArrowBackIcon />
              </IconButton>
            </Box>
          )}
          {children}
        </Box>
      )}
    </Paper>
  );
}
