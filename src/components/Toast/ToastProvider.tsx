'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { ToastContext, type ToastOptions } from './useToast';

const AUTO_HIDE_MS = 5000;

interface QueuedToast extends ToastOptions {
  key: number;
}

/**
 * Single Snackbar+Alert, one toast visible at a time. New toasts queue up;
 * the next one shows only after the current one has fully exited (avoids
 * overlapping animations / stacked toasts).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedToast[]>([]);
  const [open, setOpen] = useState(false);
  const nextKey = useRef(0);

  const showToast = useCallback((options: ToastOptions) => {
    nextKey.current += 1;
    setQueue((prev) => [...prev, { ...options, key: nextKey.current }]);
    setOpen(true);
  }, []);

  const current = queue[0];

  const handleClose = (_event?: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const handleExited = () => {
    setQueue((prev) => prev.slice(1));
  };

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key}
        open={open && Boolean(current)}
        autoHideDuration={AUTO_HIDE_MS}
        onClose={handleClose}
        slotProps={{ transition: { onExited: handleExited } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert onClose={handleClose} severity={current.severity ?? 'info'} variant="filled" sx={{ width: '100%' }}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
