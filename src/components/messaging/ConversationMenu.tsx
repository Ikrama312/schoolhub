'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { useToast } from '@/components/Toast/useToast';
import { announceMessagingChange, api } from './usePolling';
import type { ConversationDetail } from './MessageThread';

const ROLE_LABEL = { ADMIN: 'Admin', TEACHER: 'Teacher', STUDENT: 'Student', PARENT: 'Parent' } as const;

/** PRD-13 FR-14: mute, archive/unarchive, view participants, leave group (hidden unless canLeave). */
export function ConversationMenu({ conversation, onChanged }: { conversation: ConversationDetail; onChanged: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const base = `/api/conversations/${conversation.id}`;

  async function act(path: string, body: unknown, message: string) {
    setAnchor(null);
    try {
      await api(`${base}/${path}`, { method: 'POST', body });
      showToast({ message, severity: 'success' });
      announceMessagingChange();
      onChanged();
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Something went wrong.', severity: 'error' });
    }
  }

  async function leave() {
    try {
      await api(`${base}/leave`, { method: 'POST', body: {} });
      setConfirmLeave(false);
      announceMessagingChange();
      router.push('/messages');
    } catch (e) {
      setConfirmLeave(false);
      showToast({ message: e instanceof Error ? e.message : 'Could not leave the group.', severity: 'error' });
    }
  }

  const { muted, archived } = conversation.me;
  return (
    <>
      <IconButton aria-label="Conversation options" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => act('mute', { muted: !muted }, muted ? 'Conversation unmuted' : 'Conversation muted')}>
          <ListItemIcon>{muted ? <NotificationsActiveOutlinedIcon fontSize="small" /> : <NotificationsOffOutlinedIcon fontSize="small" />}</ListItemIcon>
          {muted ? 'Unmute' : 'Mute'}
        </MenuItem>
        <MenuItem onClick={() => act('archive', { archived: !archived }, archived ? 'Moved to inbox' : 'Conversation archived')}>
          <ListItemIcon>{archived ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />}</ListItemIcon>
          {archived ? 'Unarchive' : 'Archive'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setShowPeople(true);
          }}
        >
          <ListItemIcon>
            <GroupOutlinedIcon fontSize="small" />
          </ListItemIcon>
          View participants
        </MenuItem>
        {conversation.canLeave && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              setConfirmLeave(true);
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            Leave group
          </MenuItem>
        )}
      </Menu>

      <Dialog open={showPeople} onClose={() => setShowPeople(false)} fullWidth maxWidth="xs">
        <DialogTitle>Participants</DialogTitle>
        <DialogContent dividers>
          <List dense>
            {conversation.participants.map((p) => (
              <ListItem key={p.id} secondaryAction={<Chip size="small" label={ROLE_LABEL[p.role]} />}>
                <ListItemAvatar>
                  <UserAvatar userId={p.id} name={p.name} />
                </ListItemAvatar>
                <ListItemText primary={p.name} secondary={p.leftAt ? 'Left the conversation' : undefined} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPeople(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave this group?"
        description="You will stop receiving messages and lose access to this conversation."
        destructive
        confirmLabel="Leave"
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}
