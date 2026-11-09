'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerResponse } from '@/lib/validators/quiz';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'stopped';
type Resp = AnswerResponse | null;
type Queue = Record<string, Resp>;

const DEBOUNCE_MS = 800;
const RETRY_MS = 5_000;
export const queueKey = (attemptId: string) => `quiz-attempt:${attemptId}`;

function readQueue(attemptId: string): Queue {
  try {
    return JSON.parse(localStorage.getItem(queueKey(attemptId)) ?? '{}') as Queue;
  } catch {
    return {};
  }
}

/**
 * FR-15/ADR-4 autosave: 800 ms debounce per question → PUT; failures go to
 * localStorage['quiz-attempt:<id>'] and are retried every 5 s; 409 stops everything,
 * clears the queue and calls onConflict (time is up / already submitted).
 * Preview mode is a no-op (A10).
 */
export function useAutosave(attemptId: string, mode: 'live' | 'preview', onConflict: () => void) {
  const live = mode === 'live';
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latest = useRef(new Map<string, Resp>());
  const stopped = useRef(false);
  /** Questions waiting out the debounce, and ones whose last send failed (→ "Offline"). */
  const waiting = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const [, rerender] = useState(0);
  const tick = () => rerender((n) => n + 1);
  const [inflight, setInflight] = useState(0);
  const [restored, setRestored] = useState<Queue>({});
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;

  const writeQueue = useCallback(
    (fn: (q: Queue) => void) => {
      const q = readQueue(attemptId);
      fn(q);
      if (Object.keys(q).length) localStorage.setItem(queueKey(attemptId), JSON.stringify(q));
      else localStorage.removeItem(queueKey(attemptId));
    },
    [attemptId],
  );

  const send = useCallback(
    async (questionId: string) => {
      if (stopped.current || !latest.current.has(questionId)) return;
      const response = latest.current.get(questionId) ?? null;
      setInflight((n) => n + 1);
      try {
        const res = await fetch(`/api/attempts/${attemptId}/answers/${questionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response }),
        });
        if (res.status === 409) {
          stopped.current = true;
          timers.current.forEach(clearTimeout);
          localStorage.removeItem(queueKey(attemptId));
          conflictRef.current();
          return;
        }
        if (!res.ok && res.status >= 500) throw new Error(String(res.status));
        // Only drop the queued copy if nothing newer was typed meanwhile.
        failed.current.delete(questionId);
        if (JSON.stringify(latest.current.get(questionId) ?? null) === JSON.stringify(response)) {
          latest.current.delete(questionId);
          writeQueue((q) => delete q[questionId]);
        }
      } catch {
        failed.current.add(questionId);
        writeQueue((q) => (q[questionId] = response));
      } finally {
        setInflight((n) => n - 1);
      }
    },
    [attemptId, writeQueue],
  );

  // Restore + drain on mount, then retry every 5 s (FR-19: a reload loses nothing).
  useEffect(() => {
    if (!live) return;
    const q = readQueue(attemptId);
    setRestored(q);
    const drain = () => {
      for (const [qid, resp] of Object.entries(readQueue(attemptId))) {
        if (waiting.current.has(qid)) continue; // its debounce will send it
        if (!latest.current.has(qid)) latest.current.set(qid, resp);
        void send(qid);
      }
    };
    drain();
    const id = setInterval(drain, RETRY_MS);
    const t = timers.current;
    return () => {
      clearInterval(id);
      t.forEach(clearTimeout);
    };
  }, [attemptId, live, send]);

  const save = useCallback(
    (questionId: string, response: Resp) => {
      if (!live || stopped.current) return;
      latest.current.set(questionId, response);
      // Persist immediately so a reload inside the debounce window loses nothing (FR-19, AC-2).
      writeQueue((q) => (q[questionId] = response));
      waiting.current.add(questionId);
      tick();
      clearTimeout(timers.current.get(questionId));
      timers.current.set(
        questionId,
        setTimeout(() => {
          waiting.current.delete(questionId);
          tick();
          void send(questionId);
        }, DEBOUNCE_MS),
      );
    },
    [live, send, writeQueue],
  );

  /** Send everything pending now (before submit). */
  const flush = useCallback(async () => {
    if (!live) return;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    waiting.current.clear();
    await Promise.all([...latest.current.keys()].map((qid) => send(qid)));
  }, [live, send]);

  const status: SaveStatus = stopped.current
    ? 'stopped'
    : inflight > 0 || waiting.current.size > 0
      ? 'saving'
      : failed.current.size > 0
        ? 'offline'
        : 'saved';
  return { save, flush, status, restored };
}
