'use client';

import { useEffect, useRef } from 'react';

/**
 * PRD-13 FR-13/NFR-8: calls fn every `ms` while the tab is visible; pauses while hidden and fires
 * immediately when it becomes visible again (NotificationBell's pattern, as a hook).
 */
export function usePolling(fn: () => unknown, ms: number, enabled = true): void {
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void latest.current();
      timer = setInterval(() => void latest.current(), ms);
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
  }, [ms, enabled]);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: { reason?: string } & Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Minimal JSON client for the messaging endpoints: returns `data`, throws ApiError with the server message. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error?.message ?? 'Request failed', res.status, json?.error?.code, json?.error?.details);
  return json as T;
}

/** Fired after any local change (send, archive, read…) so the list and badge refresh without waiting for the poll. */
export const MESSAGING_CHANGED = 'schoolhub:messaging-changed';
export const announceMessagingChange = () => window.dispatchEvent(new Event(MESSAGING_CHANGED));
