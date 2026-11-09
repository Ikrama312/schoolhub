'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { LIST_POLL_MS } from '@/lib/messaging/constants';
import { api, MESSAGING_CHANGED, usePolling } from './usePolling';
import { NewConversationDialog } from './NewConversationDialog';

export interface UserSummary {
  id: string;
  name: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  avatarUrl: string | null;
}
export interface ConversationListItem {
  id: string;
  subject: string | null;
  participants: UserSummary[];
  preview: string | null;
  lastMessageAt: string;
  unreadCount: number;
  muted: boolean;
  archived: boolean;
}

export const conversationTitle = (c: { subject: string | null; participants: UserSummary[] }) =>
  c.subject || c.participants.map((p) => p.name).join(', ') || 'Conversation';

/** PRD-13 FR-9: Inbox/Archived tabs, search, unread badges; polls every 30 s (FR-13). */
export function ConversationList() {
  const pathname = usePathname();
  const [tab, setTab] = useState<'inbox' | 'archived'>('inbox');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ archived: String(tab === 'archived'), pageSize: '100' });
    if (q) params.set('q', q);
    try {
      setItems((await api<{ data: ConversationListItem[] }>(`/api/conversations?${params}`)).data);
    } catch {
      // Offline or signed out: keep the last list; the next poll retries.
    }
  }, [tab, q]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);
  usePolling(load, LIST_POLL_MS);
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(MESSAGING_CHANGED, onChange);
    return () => window.removeEventListener(MESSAGING_CHANGED, onChange);
  }, [load]);

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1.5 }}>
        <Typography variant="h6" component="h1">
          Messages
        </Typography>
        <Button size="small" variant="contained" startIcon={<EditOutlinedIcon />} onClick={() => setComposeOpen(true)}>
          New message
        </Button>
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ px: 1 }}>
        <Tab value="inbox" label="Inbox" />
        <Tab value="archived" label="Archived" />
      </Tabs>
      <Box sx={{ px: 2, py: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search by name or subject"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': 'Search conversations', maxLength: 100 },
          }}
        />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {items === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : items.length === 0 ? (
          <EmptyState title={q ? 'No matches' : tab === 'archived' ? 'No archived conversations' : 'No conversations yet'} />
        ) : (
          <List disablePadding>
            {items.map((c) => {
              const first = c.participants[0];
              const unread = c.unreadCount > 0;
              return (
                <ListItemButton
                  key={c.id}
                  component={NextLink}
                  href={`/messages/${c.id}`}
                  selected={pathname === `/messages/${c.id}`}
                  alignItems="flex-start"
                >
                  <ListItemAvatar>
                    <UserAvatar userId={first?.id ?? c.id} name={first?.name ?? '?'} size={40} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography noWrap sx={{ flex: 1, fontWeight: unread ? 700 : 400 }}>
                          {conversationTitle(c)}
                        </Typography>
                        {c.muted && <NotificationsOffOutlinedIcon fontSize="inherit" color="action" aria-label="Muted" />}
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {formatDistanceToNowStrict(new Date(c.lastMessageAt), { addSuffix: false })}
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      <Stack direction="row" spacing={1} component="span" sx={{ alignItems: 'center' }}>
                        <Typography component="span" variant="body2" color="text.secondary" noWrap sx={{ flex: 1, fontWeight: unread ? 600 : 400 }}>
                          {c.preview ?? ''}
                        </Typography>
                        {unread && <Badge component="span" color="primary" badgeContent={c.unreadCount} max={99} sx={{ mr: 1.5 }} />}
                      </Stack>
                    }
                    slotProps={{ secondary: { component: 'span' } }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Box>
      <NewConversationDialog open={composeOpen} onClose={() => setComposeOpen(false)} />
    </Stack>
  );
}
