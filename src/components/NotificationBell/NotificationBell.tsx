'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { isSafeRelativeLink } from '@/lib/validators/notifications';

const POLL_MS = 30_000;

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

async function api<T>(url: string, method = 'GET'): Promise<T> {
  const res = await fetch(url, { method, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json.data as T;
}

/** FR-22..25: unread badge, visibility-gated 30 s poll, popover with the 10 most recent. */
export function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setCount((await api<{ count: number }>('/api/notifications/unread-count')).count);
    } catch {
      // Signed out or offline: keep the last known count; the next poll retries.
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refreshCount();
      timer = setInterval(() => void refreshCount(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshCount]);

  const open = async (target: HTMLElement) => {
    setAnchor(target);
    setItems(null);
    try {
      setItems(await api<NotificationItem[]>('/api/notifications?pageSize=10'));
    } catch {
      setItems([]);
    }
  };

  const close = () => setAnchor(null);

  const select = async (item: NotificationItem) => {
    close();
    if (!item.readAt) await api(`/api/notifications/${item.id}/read`, 'POST').catch(() => undefined);
    if (item.link && isSafeRelativeLink(item.link)) router.push(item.link);
    void refreshCount();
  };

  const markAll = async () => {
    await api('/api/notifications/read-all', 'POST').catch(() => undefined);
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
    void refreshCount();
  };

  const label = count ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton color="inherit" aria-label={label} onClick={(e) => void open(e.currentTarget)}>
          <Badge badgeContent={count} max={9} color="error" data-testid="notification-count">
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            Notifications
          </Typography>
        </Box>
        <Divider />
        {items === null ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={24} aria-label="Loading notifications" />
          </Stack>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 4, textAlign: 'center' }}>
            You&apos;re all caught up.
          </Typography>
        ) : (
          <List dense disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.map((item) => (
              <ListItemButton key={item.id} onClick={() => void select(item)} sx={{ alignItems: 'flex-start', gap: 1 }}>
                <Box
                  aria-hidden
                  sx={{
                    mt: 1,
                    width: 8,
                    height: 8,
                    flexShrink: 0,
                    borderRadius: '50%',
                    bgcolor: item.readAt ? 'transparent' : 'primary.main',
                  }}
                />
                <ListItemText
                  primary={item.title}
                  secondary={
                    <>
                      {item.body && (
                        <Box
                          component="span"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {item.body}
                        </Box>
                      )}
                      <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
                        {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                      </Box>
                    </>
                  }
                  slotProps={{ primary: { sx: { fontWeight: item.readAt ? 400 : 700 } } }}
                />
                {!item.readAt && (
                  <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                    Unread
                  </Box>
                )}
              </ListItemButton>
            ))}
          </List>
        )}
        <Divider />
        <Stack direction="row" sx={{ justifyContent: 'space-between', px: 1, py: 1 }}>
          <Button size="small" onClick={() => void markAll()} disabled={!items?.some((n) => !n.readAt)}>
            Mark all as read
          </Button>
          <Button size="small" component={NextLink} href="/notifications" onClick={close}>
            View all
          </Button>
        </Stack>
      </Popover>
    </>
  );
}
