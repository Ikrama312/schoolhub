'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { isSafeRelativeLink } from '@/lib/validators/notifications';
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/server/notifications/types';
import type { NotificationItem } from '@/components/NotificationBell/NotificationBell';

const PAGE_SIZE = 20;

async function send(url: string, method = 'GET') {
  const res = await fetch(url, { method, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json;
}

/** FR-26: All/Unread tabs, category filter, 20/page, per-row read toggle, bulk mark-all. */
export function NotificationsList({ timezone }: { timezone: string }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState<NotificationCategory | ''>('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (tab === 'unread') params.set('unread', 'true');
      if (category) params.set('category', category);
      const json = await send(`/api/notifications?${params.toString()}`);
      setRows(json.data);
      setTotal(json.meta.total);
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [page, tab, category, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (item: NotificationItem) => {
    try {
      await send(`/api/notifications/${item.id}/${item.readAt ? 'unread' : 'read'}`, 'POST');
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    }
  };

  const markAll = async () => {
    try {
      const json = await send('/api/notifications/read-all', 'POST');
      showToast({ message: `Marked ${json.data.count} as read`, severity: 'success' });
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Box>
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="outlined" onClick={() => void markAll()}>
            Mark all as read
          </Button>
        }
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <Tabs
          value={tab}
          onChange={(_e, value: 'all' | 'unread') => {
            setTab(value);
            setPage(1);
          }}
          aria-label="Notification filter"
          sx={{ flexGrow: 1 }}
        >
          <Tab value="all" label="All" />
          <Tab value="unread" label="Unread" />
        </Tabs>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="notification-category-label">Category</InputLabel>
          <Select
            labelId="notification-category-label"
            label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as NotificationCategory | '');
              setPage(1);
            }}
          >
            <MenuItem value="">All categories</MenuItem>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Paper variant="outlined">
        {loading && <LinearProgress aria-label="Loading notifications" />}
        {!loading && rows.length === 0 ? (
          <EmptyState
            icon={<NotificationsNoneIcon sx={{ fontSize: 48 }} />}
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description="You're all caught up."
          />
        ) : (
          <List disablePadding>
            {rows.map((item) => {
              const unread = !item.readAt;
              const text = (
                <ListItemText
                  primary={item.title}
                  secondary={
                    <>
                      {item.body && (
                        <Box component="span" sx={{ display: 'block', whiteSpace: 'pre-line' }}>
                          {item.body}
                        </Box>
                      )}
                      <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                        {formatInSchoolTz(item.createdAt, 'MMM d, yyyy h:mm a', timezone)}
                      </Box>
                    </>
                  }
                  slotProps={{ primary: { sx: { fontWeight: unread ? 700 : 400 } } }}
                />
              );
              return (
                <ListItem
                  key={item.id}
                  divider
                  disablePadding
                  secondaryAction={
                    <Tooltip title={unread ? 'Mark as read' : 'Mark as unread'}>
                      <IconButton
                        edge="end"
                        aria-label={unread ? `Mark "${item.title}" as read` : `Mark "${item.title}" as unread`}
                        onClick={() => void toggle(item)}
                      >
                        {unread ? <MarkEmailReadOutlinedIcon /> : <MarkEmailUnreadOutlinedIcon />}
                      </IconButton>
                    </Tooltip>
                  }
                  sx={{ bgcolor: unread ? 'action.hover' : undefined }}
                >
                  {item.link && isSafeRelativeLink(item.link) ? (
                    <ListItemButton
                      component={NextLink}
                      href={item.link}
                      onClick={() => {
                        if (unread) void send(`/api/notifications/${item.id}/read`, 'POST').catch(() => undefined);
                      }}
                    >
                      {text}
                    </ListItemButton>
                  ) : (
                    <Box sx={{ px: 2, py: 1, flexGrow: 1 }}>{text}</Box>
                  )}
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>
      {pages > 1 && (
        <Stack sx={{ alignItems: 'center', mt: 2 }}>
          <Pagination count={pages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
        </Stack>
      )}
    </Box>
  );
}
