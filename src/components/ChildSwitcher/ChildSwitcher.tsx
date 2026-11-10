'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { useToast } from '@/components/Toast/useToast';

export interface SwitcherChild {
  studentId: string;
  firstName: string;
  lastName: string;
}

function Label({ child }: { child: SwitcherChild }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <UserAvatar userId={child.studentId} name={`${child.firstName} ${child.lastName}`} size={24} />
      <span>{child.firstName}</span>
    </Box>
  );
}

/**
 * PRD-15 top-bar child switcher (FR-3, FR-6). One child → name only, no dropdown.
 * A change POSTs /api/me/selected-child (server validates the link and sets sh_child), then refreshes.
 */
export function ChildSwitcher({ items, selectedId }: { items: SwitcherChild[]; selectedId: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [value, setValue] = useState(selectedId ?? items[0]?.studentId ?? '');
  const [busy, setBusy] = useState(false);

  if (items.length === 0) return null;
  if (items.length === 1) {
    return (
      <Typography component="div" sx={{ color: 'inherit', mr: 1 }} aria-label="Selected child">
        <Label child={items[0]} />
      </Typography>
    );
  }

  async function change(studentId: string) {
    const previous = value;
    setValue(studentId);
    setBusy(true);
    try {
      const res = await fetch('/api/me/selected-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      });
      if (!res.ok) throw new Error();
      // Child-specific pages live under /my-children/<id>; follow the switch there.
      const match = window.location.pathname.match(/^\/my-children\/([^/]+)(\/.*)?$/);
      if (match && match[1] !== studentId) router.push(`/my-children/${studentId}${match[2] ?? ''}`);
      router.refresh();
    } catch {
      setValue(previous);
      showToast({ message: 'Could not switch child. Try again.', severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Select
      size="small"
      value={value}
      disabled={busy}
      onChange={(e) => void change(e.target.value)}
      inputProps={{ 'aria-label': 'Select child' }}
      renderValue={(id) => {
        const child = items.find((c) => c.studentId === id);
        return child ? <Label child={child} /> : '';
      }}
      sx={{ color: 'inherit', mr: 1, minWidth: 140, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' }, '& .MuiSvgIcon-root': { color: 'inherit' } }}
    >
      {items.map((c) => (
        <MenuItem key={c.studentId} value={c.studentId}>
          <Label child={c} />
        </MenuItem>
      ))}
    </Select>
  );
}
