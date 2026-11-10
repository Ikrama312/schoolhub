'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useToast } from '@/components/Toast/useToast';

/** PRD-16 FR-24 (ADMIN only): recompute risk + revalidate caches, then re-render widgets. */
export function RefreshButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/refresh', { method: 'POST' });
      if (!res.ok) throw new Error();
      const { data } = (await res.json()) as { data: { studentsComputed: number } };
      showToast({ message: `Dashboard refreshed (${data.studentsComputed} students recomputed)`, severity: 'success' });
      router.refresh();
    } catch {
      showToast({ message: 'Could not refresh the dashboard. Try again.', severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={busy}>
      {busy ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
}
