'use client';

import { Fragment, useState } from 'react';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from '@/server/notifications/types';
import type { NotificationPreferenceItem } from '@/server/notifications/preferences';

/** FR-28..30: grouped by category, mandatory in-app locked, optimistic PUT with rollback. */
export function PreferencesTable({ initial }: { initial: NotificationPreferenceItem[] }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(initial);

  const update = async (type: string, patch: Partial<Pick<NotificationPreferenceItem, 'inApp' | 'email'>>) => {
    const previous = items;
    const current = items.find((i) => i.type === type);
    if (!current) return;
    const next = { ...current, ...patch };
    setItems((list) => list.map((i) => (i.type === type ? next : i)));
    try {
      const res = await fetch('/api/me/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, inApp: next.inApp, email: next.email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not save preference');
      setItems((list) => list.map((i) => (i.type === type ? json.data : i)));
    } catch (error) {
      setItems(previous);
      showToast({ message: (error as Error).message, severity: 'error' });
    }
  };

  if (items.length === 0) {
    return <EmptyState title="Nothing to configure" description="There are no notification types for your role yet." />;
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label="Notification preferences">
        <TableHead>
          <TableRow>
            <TableCell>Notification</TableCell>
            <TableCell align="center">In app</TableCell>
            <TableCell align="center">Email</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {NOTIFICATION_CATEGORIES.map((category) => {
            const rows = items.filter((i) => i.category === category);
            if (rows.length === 0) return null;
            return (
              <Fragment key={category}>
                <TableRow>
                  <TableCell colSpan={3} component="th" scope="colgroup" sx={{ bgcolor: 'action.hover', fontWeight: 600 }}>
                    {CATEGORY_LABELS[category]}
                  </TableCell>
                </TableRow>
                {rows.map((item) => (
                  <TableRow key={item.type}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {item.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {item.description}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {item.mandatoryInApp ? (
                        <Tooltip title="Required by the school">
                          <span>
                            <Switch checked disabled slotProps={{ input: { 'aria-label': `${item.label} in app (required)` } }} />
                          </span>
                        </Tooltip>
                      ) : (
                        <Switch
                          checked={item.inApp}
                          onChange={(e) => void update(item.type, { inApp: e.target.checked })}
                          slotProps={{ input: { 'aria-label': `${item.label} in app` } }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={item.email}
                        onChange={(e) => void update(item.type, { email: e.target.checked })}
                        slotProps={{ input: { 'aria-label': `${item.label} email` } }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
