'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import type { StudentAssignmentRow } from '@/server/assignments/assignments-service';

type Group = StudentAssignmentRow['group'];

const GROUPS: { key: Group; label: string }[] = [
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'MISSING', label: 'Missing' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'RETURNED', label: 'Returned' },
  { key: 'CLOSED', label: 'Past due' },
];
const TABS = GROUPS.filter((g) => g.key !== 'CLOSED');
const pts = (s: string) => String(Number(s));

function RowChip({ row }: { row: StudentAssignmentRow }) {
  if (row.exempt) return <Chip size="small" label="Exempt" />;
  if (row.group === 'MISSING') return <Chip size="small" color="error" label="Missing" />;
  if (row.group === 'RETURNED' && row.submission?.finalScore != null)
    return <Chip size="small" color="success" label={`${pts(row.submission.finalScore)}/${pts(row.assignment.maxPoints)}`} />;
  if (row.group === 'SUBMITTED') return <Chip size="small" color={row.submission?.isLate ? 'warning' : 'info'} label={row.submission?.isLate ? 'Submitted late' : 'Awaiting grading'} />;
  return null;
}

export interface AssignmentListProps {
  rows: StudentAssignmentRow[];
  timezone: string;
  /** 'grouped' = course tab (FR-18); 'tabs' = /assignments (FR-37). */
  variant: 'grouped' | 'tabs';
  showCourse?: boolean;
  courses?: { id: string; name: string }[];
  /** PARENT: linked children for a per-page selector (course tab only; /assignments uses the top-bar child switcher, PRD-15 FR-5). */
  childOptions?: { id: string; name: string }[];
  /** PARENT: the child being viewed; carried into assignment links as ?studentId=. */
  studentId?: string;
}

/** Shared student/parent assignment list. Read-only by nature; actions live on the assignment page. */
export function AssignmentList({ rows, timezone, variant, showCourse, courses, childOptions, studentId }: AssignmentListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Group>('UPCOMING');
  const [courseId, setCourseId] = useState('');

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };

  const filtered = rows.filter((r) => !courseId || r.assignment.courseId === courseId);
  const link = (r: StudentAssignmentRow) =>
    `/courses/${r.assignment.courseId}/assignments/${r.assignment.id}${studentId && (childOptions?.length || !childOptions) ? `?studentId=${studentId}` : ''}`;

  const renderRows = (items: StudentAssignmentRow[]) =>
    items.map((r) => (
      <ListItemButton key={r.assignment.id} component={NextLink} href={link(r)} divider>
        <ListItemText
          primary={r.assignment.title}
          secondary={[showCourse ? r.assignment.courseName : null, `Due ${formatInSchoolTz(r.assignment.dueAt, 'EEE d MMM, HH:mm', timezone)}`]
            .filter(Boolean)
            .join(' · ')}
        />
        <RowChip row={r} />
      </ListItemButton>
    ));

  const filters = (childOptions && childOptions.length > 1) || (courses && courses.length > 1);

  return (
    <Box>
      {filters && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          {childOptions && childOptions.length > 1 && (
            <TextField select size="small" label="Child" value={studentId ?? ''} onChange={(e) => setParam('studentId', e.target.value)} sx={{ minWidth: 200 }}>
              {childOptions.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {courses && courses.length > 1 && (
            <TextField select size="small" label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">All courses</MenuItem>
              {courses.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
      )}

      {variant === 'tabs' ? (
        <>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" aria-label="Assignment status" sx={{ mb: 1 }}>
            {TABS.map((t) => (
              <Tab key={t.key} value={t.key} label={`${t.label} (${filtered.filter((r) => r.group === t.key).length})`} />
            ))}
          </Tabs>
          <Paper variant="outlined">
            {filtered.some((r) => r.group === tab) ? (
              <List disablePadding>{renderRows(filtered.filter((r) => r.group === tab))}</List>
            ) : (
              <EmptyState title="Nothing here" description="No assignments in this list." />
            )}
          </Paper>
        </>
      ) : filtered.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState title="No assignments yet" />
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {GROUPS.filter((g) => filtered.some((r) => r.group === g.key)).map((g) => (
              <li key={g.key}>
                <ul style={{ padding: 0 }}>
                  <ListSubheader>{g.label === 'Missing' ? 'Past due (missing)' : g.label}</ListSubheader>
                  {renderRows(filtered.filter((r) => r.group === g.key))}
                </ul>
              </li>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
