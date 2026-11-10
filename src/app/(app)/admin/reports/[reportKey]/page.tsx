import { notFound } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import DownloadIcon from '@mui/icons-material/Download';
import { ZodError } from 'zod';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { DataTable } from '@/components/DataTable/DataTable';
import { ChartA11y } from '@/components/charts/ChartA11y';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { isReportKey, runReport, type ReportResult } from '@/server/reports';
import type { ReportKey } from '@/lib/validators/reports';
import { ReportFilters, type FilterField } from './_components/ReportFilters';

export const dynamic = 'force-dynamic';

const FIELDS: Record<ReportKey, FilterField[]> = {
  enrollment: ['dateRange', 'gradeLevel', 'sectionId'],
  attendance: [
    'dateRange',
    { key: 'groupBy', options: [{ id: 'gradeLevel', name: 'Grade level' }, { id: 'section', name: 'Section' }, { id: 'course', name: 'Course' }] },
    'gradeLevel',
    'sectionId',
  ],
  performance: [{ key: 'groupBy', options: [{ id: 'course', name: 'Course' }, { id: 'subject', name: 'Subject' }] }, 'gradeLevel', 'subjectId'],
  completion: ['dateRange', { key: 'groupBy', options: [{ id: 'course', name: 'Course' }, { id: 'teacher', name: 'Teacher' }] }],
  engagement: [],
  workload: [],
};

/** PRD-16 FR-33–FR-39: one report — filters in the URL, chart(s), table and CSV of the same rows. */
export default async function ReportPage({ params, searchParams }: { params: { reportKey: string }; searchParams: Record<string, string | undefined> }) {
  await requirePageRole('ADMIN');
  if (!isReportKey(params.reportKey)) notFound();
  const key = params.reportKey;

  let result: ReportResult | null = null;
  let error: string | null = null;
  try {
    result = await runReport(key, { ...searchParams, format: undefined });
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    error = e.issues.map((i) => i.message).join(' ');
  }

  const [years, gradeLevels, subjects] = await Promise.all([
    prisma.academicYear.findMany({ select: { id: true, name: true, terms: { select: { id: true, name: true }, orderBy: { order: 'asc' } } }, orderBy: { startDate: 'desc' } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.subject.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const yearId = result?.filters.academicYearId ?? years[0]?.id ?? '';
  const sections = await prisma.section.findMany({ where: { academicYearId: yearId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

  const csvQuery = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => !!e[1] && e[0] !== 'page' && e[0] !== 'pageSize'));
  csvQuery.set('format', 'csv');
  const today = new Date().toISOString().slice(0, 10);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const pageSize = Math.min(100, Number(searchParams.pageSize) || 20);

  return (
    <>
      <PageHeader
        title={result?.title ?? 'Report'}
        breadcrumbs={[{ label: 'Reports', href: '/admin/reports' }, { label: result?.title ?? key }]}
        actions={
          <Button component="a" href={`/api/reports/${key}?${csvQuery.toString()}`} variant="outlined" startIcon={<DownloadIcon />}>
            Download CSV
          </Button>
        }
      />
      <ReportFilters
        fields={FIELDS[key]}
        years={years}
        selected={{
          academicYearId: yearId,
          termId: result?.filters.termId ?? null,
          from: result?.filters.from ?? today,
          to: result?.filters.to ?? today,
        }}
        gradeLevels={gradeLevels}
        sections={sections}
        subjects={subjects}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {result && (
        <Stack spacing={3}>
          {result.notes.map((n) => (
            <Alert key={n} severity="info">
              {n}
            </Alert>
          ))}
          <Grid container spacing={2}>
            {result.charts.map((c) => (
              <Grid key={c.summary} size={{ xs: 12, lg: result!.charts.length > 1 ? 6 : 12 }}>
                <Card variant="outlined">
                  <CardContent>
                    <ChartA11y kind={c.kind} chart={c} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <DataTable
            columns={result.columns.map((c) => ({ field: c.key, headerName: c.header, flex: 1, minWidth: 110, sortable: false }))}
            rows={result.rows.map((r, i) => ({ id: i, ...r })).slice((page - 1) * pageSize, page * pageSize)}
            total={result.rows.length}
          />
        </Stack>
      )}
    </>
  );
}
