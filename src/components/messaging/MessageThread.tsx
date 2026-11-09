'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { FileList } from '@/components/FileList/FileList';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { BODY_MAX, DELETED_TEXT, REASON_MAX, THREAD_POLL_MS } from '@/lib/messaging/constants';
import { announceMessagingChange, api, ApiError, usePolling } from './usePolling';
import { Composer } from './Composer';
import { ConversationMenu } from './ConversationMenu';
import { conversationTitle, type UserSummary } from './ConversationList';

export interface MessageDTO {
  id: string;
  conversationId: string;
  sender: UserSummary;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: { fileId: string; name: string; mimeType: string; size: number; url: string }[];
  isOwn: boolean;
  canEdit: boolean;
}

export interface ConversationDetail {
  id: string;
  subject: string | null;
  createdById: string;
  involvesStudent: boolean;
  lastMessageAt: string;
  participants: (UserSummary & { leftAt: string | null })[];
  me: { lastReadAt: string | null; muted: boolean; archived: boolean };
  canSend: boolean;
  canLeave: boolean;
}

type Page = { messages: MessageDTO[]; changed: MessageDTO[]; hasMore: boolean };

const byTime = (a: MessageDTO, b: MessageDTO) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
function merge(current: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  if (!incoming.length) return current;
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(byTime);
}
const maxUpdated = (ms: MessageDTO[], prev: string | null) =>
  ms.reduce<string | null>((acc, m) => (acc === null || m.updatedAt > acc ? m.updatedAt : acc), prev);

/**
 * PRD-13 FR-10/FR-13/FR-14/FR-15/FR-22: day-grouped thread in the school timezone, upward infinite
 * scroll (?before=), 5 s poll (?after=&since=) for new + edited/deleted messages, mark-read while
 * visible, and a per-message menu (edit/delete own within 15 min, report others').
 */
export function MessageThread({ conversationId, timezone, viewerId }: { conversationId: string; timezone: string; viewerId: string }) {
  const { showToast } = useToast();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; message: MessageDTO } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<MessageDTO | null>(null);
  const [reporting, setReporting] = useState<{ message: MessageDTO; reason: string; busy: boolean } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const since = useRef<string | null>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);
  const messagesRef = useRef<MessageDTO[]>([]);
  messagesRef.current = messages;

  const base = `/api/conversations/${conversationId}`;

  const markRead = useCallback(async () => {
    try {
      await api(`${base}/read`, { method: 'POST', body: {} });
      announceMessagingChange();
    } catch {
      // Best effort; the next visible poll retries.
    }
  }, [base]);

  const loadConversation = useCallback(async () => {
    try {
      setConversation((await api<{ data: ConversationDetail }>(base)).data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [base]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setMessages([]);
    setNotFound(false);
    since.current = null;
    stickToBottom.current = true;
    void (async () => {
      try {
        const [conv, page] = await Promise.all([
          api<{ data: ConversationDetail }>(base),
          api<{ data: Page }>(`${base}/messages`),
        ]);
        if (cancelled) return;
        setConversation(conv.data);
        setMessages(page.data.messages);
        setHasMore(page.data.hasMore);
        since.current = maxUpdated(page.data.messages, null);
        void markRead();
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status === 404) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, markRead]);

  // 5 s poll for new messages plus edits/deletes since the newest updatedAt we have seen (server clock).
  const poll = useCallback(async () => {
    const current = messagesRef.current;
    const last = current[current.length - 1];
    if (!last) return;
    const params = new URLSearchParams({ after: last.id });
    if (since.current) params.set('since', since.current);
    try {
      const { data } = await api<{ data: Page }>(`${base}/messages?${params}`);
      if (!data.messages.length && !data.changed.length) return;
      since.current = maxUpdated([...data.messages, ...data.changed], since.current);
      setMessages((prev) => merge(prev, [...data.messages, ...data.changed]));
      if (data.messages.some((m) => !m.isOwn) && document.visibilityState === 'visible') void markRead();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [base, markRead]);
  usePolling(poll, THREAD_POLL_MS, conversation !== null && !notFound);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data } = await api<{ data: Page }>(`${base}/messages?${new URLSearchParams({ before: first.id })}`);
      restoreFrom.current = scroller.current?.scrollHeight ?? null;
      stickToBottom.current = false;
      setMessages((prev) => merge(prev, data.messages));
      setHasMore(data.hasMore);
    } catch {
      // Leave hasMore set; scrolling up again retries.
    } finally {
      setLoadingOlder(false);
    }
  }, [base, loadingOlder]);

  // Upward infinite scroll: load older when the top sentinel becomes visible.
  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlder(), { root, rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadOlder, messages.length]);

  // Keep the reading position stable when older messages are prepended; follow new ones at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const replace = (m: MessageDTO) => {
    since.current = maxUpdated([m], since.current);
    setMessages((prev) => merge(prev, [m]));
  };

  async function saveEdit() {
    if (!editing) return;
    try {
      const { data } = await api<{ data: { message: MessageDTO } }>(`/api/messages/${editing.id}`, { method: 'PATCH', body: { body: editing.text } });
      replace(data.message);
      setEditing(null);
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not edit the message.', severity: 'error' });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const { data } = await api<{ data: { message: MessageDTO } }>(`/api/messages/${deleting.id}`, { method: 'DELETE' });
      replace(data.message);
      announceMessagingChange();
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not delete the message.', severity: 'error' });
    } finally {
      setDeleting(null);
    }
  }

  async function submitReport() {
    if (!reporting) return;
    setReporting({ ...reporting, busy: true });
    try {
      await api(`/api/messages/${reporting.message.id}/report`, { method: 'POST', body: { reason: reporting.reason } });
      showToast({ message: 'Reported — the school will review this.', severity: 'success' });
      setReporting(null);
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not report the message.', severity: 'error' });
      setReporting((r) => (r ? { ...r, busy: false } : r));
    }
  }

  if (notFound) return <EmptyState title="Conversation not found" description="It may not exist, or you are no longer a participant." />;
  if (!conversation) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const others = conversation.participants.filter((p) => !p.leftAt && p.id !== viewerId);
  const title = conversationTitle({ subject: conversation.subject, participants: others });
  let lastDay = '';

  return (
    <Stack sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="p">
            {others.map((p) => p.name).join(', ')}
          </Typography>
        </Box>
        <ConversationMenu conversation={conversation} onChanged={loadConversation} />
      </Stack>

      <Box ref={scroller} onScroll={onScroll} sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1, minHeight: 0 }} role="log" aria-live="polite">
        <div ref={sentinel} />
        {loadingOlder && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {messages.map((m) => {
          const day = formatInSchoolTz(m.createdAt, 'yyyy-MM-dd', timezone);
          const showDay = day !== lastDay;
          lastDay = day;
          const canReport = !m.isOwn && !m.deleted;
          return (
            <Fragment key={m.id}>
              {showDay && (
                <Divider sx={{ my: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {formatInSchoolTz(m.createdAt, 'EEEE d MMMM yyyy', timezone)}
                  </Typography>
                </Divider>
              )}
              <Stack direction="row" spacing={1.5} sx={{ py: 0.75, '&:hover .msg-actions': { opacity: 1 } }} data-testid="message">
                <UserAvatar userId={m.sender.id} name={m.sender.name} size={36} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                    <Typography variant="subtitle2">{m.sender.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatInSchoolTz(m.createdAt, 'h:mm a', timezone)}
                    </Typography>
                    {m.editedAt && !m.deleted && (
                      <Typography variant="caption" color="text.secondary">
                        (edited)
                      </Typography>
                    )}
                  </Stack>
                  {editing?.id === m.id ? (
                    <Stack spacing={1} sx={{ mt: 0.5 }}>
                      <TextField
                        multiline
                        size="small"
                        maxRows={8}
                        value={editing.text}
                        autoFocus
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        error={editing.text.length > BODY_MAX}
                        slotProps={{ htmlInput: { 'aria-label': 'Edit message' } }}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button size="small" variant="contained" onClick={saveEdit} disabled={!editing.text.trim() || editing.text.length > BODY_MAX}>
                          Save
                        </Button>
                        <Button size="small" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </Stack>
                    </Stack>
                  ) : m.deleted ? (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      {DELETED_TEXT}
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {m.body}
                    </Typography>
                  )}
                  {!m.deleted && (
                    <FileList files={m.attachments.map((a) => ({ id: a.fileId, filename: a.name, mimeType: a.mimeType, size: a.size }))} />
                  )}
                </Box>
                {(m.canEdit || canReport) && editing?.id !== m.id && (
                  <IconButton
                    className="msg-actions"
                    size="small"
                    aria-label="Message options"
                    onClick={(e) => setMenu({ anchor: e.currentTarget, message: m })}
                    sx={{ alignSelf: 'flex-start', opacity: { xs: 1, md: 0.4 } }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </Fragment>
          );
        })}
      </Box>

      <Composer
        conversationId={conversationId}
        canSend={conversation.canSend}
        onSent={(m) => {
          stickToBottom.current = true;
          replace(m);
          announceMessagingChange();
        }}
      />

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu?.message.canEdit && [
          <MenuItem
            key="edit"
            onClick={() => {
              setEditing({ id: menu.message.id, text: menu.message.body ?? '' });
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Edit
          </MenuItem>,
          <MenuItem
            key="delete"
            onClick={() => {
              setDeleting(menu.message);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <DeleteOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Delete
          </MenuItem>,
        ]}
        {menu && !menu.message.isOwn && (
          <MenuItem
            onClick={() => {
              setReporting({ message: menu.message, reason: '', busy: false });
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <FlagOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Report
          </MenuItem>
        )}
      </Menu>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this message?"
        description="Everyone in the conversation will see “This message was deleted”."
        destructive
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <Dialog open={reporting !== null} onClose={() => !reporting?.busy && setReporting(null)} fullWidth maxWidth="sm">
        <DialogTitle>Report message</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            A safeguarding lead at the school will review this message.
          </Alert>
          <TextField
            label="Why are you reporting this?"
            multiline
            minRows={3}
            fullWidth
            autoFocus
            value={reporting?.reason ?? ''}
            onChange={(e) => setReporting((r) => (r ? { ...r, reason: e.target.value } : r))}
            slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReporting(null)} disabled={reporting?.busy}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={submitReport} disabled={!reporting?.reason.trim()} loading={reporting?.busy}>
            Report
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
