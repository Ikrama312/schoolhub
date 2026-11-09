'use client';

import { createContext, useContext } from 'react';
import type { AlertColor } from '@mui/material/Alert';

export interface ToastOptions {
  message: string;
  severity?: AlertColor;
}

export interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
