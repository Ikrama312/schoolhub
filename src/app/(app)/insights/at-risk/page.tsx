import Button from '@mui/material/Button';
import DownloadIcon from '@mui/icons-material/Download';
import Typography from '@mui/material/Typography';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { currentTerm } from '@/server/dashboards/insights';
import { listAtRisk } from '@/server/dashboards/risk';
import { atRiskQuery } from '@/lib/validators/dashboards';
import { formatInSchoolTz } from '@/lib/dates';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { AtRiskFilters, AtRiskTable } from './_components/AtRiskFilters';

export const dynamic = 'force-dynamic';

/** PRD-16 FR-29/FR-30: scoped at-risk list with URL filters and a CSV of the same rows. */
export default async function AtRiskPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = await requirePageRole('ADMIN', 'TEACHER');
  const parsed = atRiskQuery.safeParse(searchParams);
  const { page, pageSize, format: _format, ...filters } = parsed.success ? parsed.data : atRiskQuery.parse({});
  const term = await currentTerm();
  const [list, gradeLevels, sections, tz] = await Promise.all([
    listAtRisk(user, filters, { page, pageSize }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    term
      ? prisma.section.findMany({
          where: {
            academicYearId: term.academicYearId,
            ...(user.role === 'TEACHER'
              ? { OR: [{ homeroomTeacherId: user.id }, { members: { some: { student: { enrollments: { some: { status: 'ACTIVE', course: { OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] } } } } } } }] }
              : {}),
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    getSchoolTimezone(),
  ]);
  const csv = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => !!e[1]));
  csv.set('format', 'csv');

  return (
    <>
      <PageHeader
        title="At-risk students"
        description={term ? `${term.name} · rules: attendance, grades below 60 %, missing work` : 'No current term'}
        actions={
          <Button component="a" href={`/api/insights/at-risk?${csv.toString()}`} variant="outlined" startIcon={<DownloadIcon />}>
            Download CSV
          </Button>
        }
      />
      <AtRiskFilters gradeLevels={gradeLevels} sections={sections} />
      <AtRiskTable rows={list.rows} total={list.total} />
      {list.computedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Computed {formatInSchoolTz(list.computedAt, 'd MMM yyyy, HH:mm', tz)}
        </Typography>
      )}
    </>
  );
}
