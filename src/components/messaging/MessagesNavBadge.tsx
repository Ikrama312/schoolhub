'use client';

import { useCallback, useEffect, useState } from 'react';
import Badge from '@mui/material/Badge';
import { LIST_POLL_MS } from '@/lib/messaging/constants';
import { api, MESSAGING_CHANGED, usePolling } from './usePolling';

/** PRD-13 FR-18: unread-conversation count on the sidebar Messages icon; polls every 30 s. */
export function MessagesNavBadge({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    try {
      setCount((await api<{ data: { count: number } }>('/api/messaging/unread-count')).data.count);
    } catch {
      // Keep the last known count; the next poll retries.
    }
  }, []);
  usePolling(load, LIST_POLL_MS);
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener(MESSAGING_CHANGED, onChange);
    return () => window.removeEventListener(MESSAGING_CHANGED, onChange);
  }, [load]);

  return (
    <Badge color="error" badgeContent={count} max={99} aria-label={count ? `${count} unread conversations` : undefined}>
      {children}
    </Badge>
  );
}
