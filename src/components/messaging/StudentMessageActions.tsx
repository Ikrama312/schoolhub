'use client';

import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { NewConversationDialog } from './NewConversationDialog';
import type { UserSummary } from './ConversationList';

export type StudentMessageActionsProps =
  | { mode: 'parents'; studentName: string; parents: UserSummary[] }
  | { mode: 'teacher'; childFirstName: string };

/**
 * PRD-13 FR-16: TEACHER/ADMIN "Message parents" (prefilled with the linked parents the viewer may
 * message); PARENT "Message teacher" (picker limited to "My child's teachers (<child>)").
 */
export function StudentMessageActions(props: StudentMessageActionsProps) {
  const [open, setOpen] = useState(false);
  const childLabel = props.mode === 'teacher' ? `My child's teachers (${props.childFirstName})` : '';
  const groupFilter = useCallback((label: string) => label === childLabel, [childLabel]);

  return (
    <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
      <Button variant="outlined" size="small" startIcon={<ChatBubbleOutlineOutlinedIcon />} onClick={() => setOpen(true)}>
        {props.mode === 'parents' ? 'Message parents' : 'Message teacher'}
      </Button>
      {props.mode === 'parents' ? (
        <NewConversationDialog open={open} onClose={() => setOpen(false)} initialRecipients={props.parents} initialSubject={props.studentName} />
      ) : (
        <NewConversationDialog open={open} onClose={() => setOpen(false)} groupFilter={groupFilter} />
      )}
    </Stack>
  );
}
