'use client';

import { useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import type { StudentGrades } from '@/server/gradebook/student-grades-service';

const pts = (v: string) => String(Number(v));

/**
 * PRD-11 student/parent grade view (FR-26–FR-28). Renders only what GET /api/students/:id/grades
 * returns (visible items, released scores). One card per course; expand for items and subtotals.
 */
export function StudentGradesView({ initial, courseId }: { initial: StudentGrades; courseId?: string }) {
  const { showToast } = useToast();
  const [data, setData] = useState(initial);

  const changeTerm = async (termId: string) => {
    const q = new URLSearchParams({ termId, ...(courseId ? { courseId } : {}) });
    const res = await fetch(`/api/students/${data.student.id}/grades?${q}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not load grades.', severity: 'error' });
    setData(json.data);
  };

  if (!data.term) return <EmptyState title="No terms yet" description="Grades appear once the school year has terms." />;

  return (
    <Stack spacing={2}>
      {data.terms.length > 1 && (
        <TextField select size="small" label="Term" value={data.term.id} onChange={(e) => void changeTerm(e.target.value)} sx={{ maxWidth: 240 }}>
          {data.terms.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
              {t.isCurrent ? ' (current)' : ''}
            </MenuItem>
          ))}
        </TextField>
      )}
      {data.courses.length === 0 && <EmptyState title="No courses" description="There are no grades for this term." />}
      {data.courses.map((c) => (
        <Card key={c.course.id} variant="outlined" data-testid={`grades-course-${c.course.code}`}>
          <CardContent sx={{ pb: 1 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" component="h2" noWrap>
                  {c.course.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {c.course.code}
                  {c.course.teacherName ? ` · ${c.course.teacherName}` : ''}
                </Typography>
              </Stack>
              <Chip
                color={c.colour ?? 'default'}
                label={c.percent === null ? 'No grade yet' : `${c.percent}% ${c.letter ?? ''}`.trim()}
                sx={{ fontWeight: 700 }}
                aria-label={c.percent === null ? 'No grade yet' : `Term grade ${c.percent} percent, ${c.letter ?? 'no letter'}`}
              />
            </Stack>
            {c.descriptor && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {c.descriptor}
              </Typography>
            )}
          </CardContent>
          <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">
                {c.items.length} item{c.items.length === 1 ? '' : 's'}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ overflowX: 'auto' }}>
              {c.categories.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
                  {c.categories.map((cat) => (
                    <Chip
                      key={cat.id ?? 'none'}
                      variant="outlined"
                      size="small"
                      label={`${cat.name}${Number(cat.weightPercent) ? ` (${pts(cat.weightPercent)}%)` : ''}: ${cat.percent === null ? '—' : `${cat.percent}%`}`}
                    />
                  ))}
                </Stack>
              )}
              <Table size="small" aria-label={`${c.course.name} grades`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Score</TableCell>
                    <TableCell align="right">%</TableCell>
                    <TableCell>Comment</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {c.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <span>{i.title}</span>
                          {i.missing && !i.excused && i.score === null && <Chip size="small" color="error" label="Missing" />}
                          {i.excused && <Chip size="small" label="Excused" />}
                          {i.dropped && <Chip size="small" variant="outlined" label="Dropped" />}
                        </Stack>
                      </TableCell>
                      <TableCell>{i.categoryName}</TableCell>
                      <TableCell align="right">{i.excused ? 'EX' : `${i.score === null ? '—' : pts(i.score)} / ${pts(i.maxPoints)}`}</TableCell>
                      <TableCell align="right">{i.percent ?? '—'}</TableCell>
                      <TableCell>{i.comment ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        </Card>
      ))}
    </Stack>
  );
}
