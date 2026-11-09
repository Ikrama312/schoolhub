'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { NewConversationDialog } from '@/components/messaging/NewConversationDialog';

export interface RosterRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  profileUrl: string;
  admissionNumber: string | null;
  status: 'ACTIVE' | 'DROPPED';
  enrolled: string;
}

/** Staff roster table with selection and PRD-13 FR-17 "Message selected students". Only ACTIVE students are selectable. */
export function RosterTable({ rows, courseCode }: { rows: RosterRow[]; courseCode: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const selectable = rows.filter((r) => r.status === 'ACTIVE');
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.studentId));
  const recipients = useMemo(
    () => rows.filter((r) => selected.has(r.studentId)).map((r) => ({ id: r.studentId, name: r.name, role: 'STUDENT' as const, avatarUrl: null })),
    [rows, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <TableContainer component={Paper} variant="outlined">
      <Toolbar variant="dense" sx={{ gap: 2 }}>
        <Typography variant="body2" sx={{ flex: 1 }} color="text.secondary">
          {selected.size ? `${selected.size} selected` : 'Select students to message them'}
        </Typography>
        <Button size="small" variant="contained" startIcon={<ChatBubbleOutlineOutlinedIcon />} disabled={!selected.size} onClick={() => setOpen(true)}>
          Message selected students
        </Button>
      </Toolbar>
      <Table size="small" aria-label="Course roster">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                disabled={!selectable.length}
                onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.studentId)))}
                slotProps={{ input: { 'aria-label': 'Select all students' } }}
              />
            </TableCell>
            <TableCell>Student</TableCell>
            <TableCell>Admission no.</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Enrolled</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.enrollmentId} selected={selected.has(r.studentId)}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selected.has(r.studentId)}
                  disabled={r.status !== 'ACTIVE'}
                  onChange={() => toggle(r.studentId)}
                  slotProps={{ input: { 'aria-label': `Select ${r.name}` } }}
                />
              </TableCell>
              <TableCell>
                <Link href={r.profileUrl}>{r.name}</Link>
              </TableCell>
              <TableCell>{r.admissionNumber ?? '—'}</TableCell>
              <TableCell>
                <Chip size="small" color={r.status === 'ACTIVE' ? 'success' : 'default'} label={r.status} />
              </TableCell>
              <TableCell>{r.enrolled}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <NewConversationDialog open={open} onClose={() => setOpen(false)} initialRecipients={recipients} initialSubject={courseCode} />
    </TableContainer>
  );
}
