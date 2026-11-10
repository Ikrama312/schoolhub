import type { z } from 'zod';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { schoolDateOf } from '@/lib/dates';
import {
  attendanceFilters,
  completionFilters,
  engagementFilters,
  enrollmentFilters,
  performanceFilters,
  REPORT_KEYS,
  workloadFilters,
  type ReportKey,
} from '@/lib/validators/reports';
import * as enrollment from './enrollment';
import * as attendance from './attendance';
import * as performance from './performance';
import * as completion from './completion';
import * as engagement from './engagement';
import * as workload from './workload';

/**
 * PRD-16 reports registry (FR-33, FR-44). The page, the API and the CSV all read this, so CSV rows
 * equal table rows (FR-35 AC 7) and an unknown key is a 404.
 */

export interface ChartSeries {
  summary: string;
  xAxis: (string | number)[];
  series: { id: string; label: string; data: (number | null)[]; stack?: string }[];
  referenceLine?: number;
  kind: 'line' | 'bar';
}

export interface Column {
  key: string;
  header: string;
}

export interface ReportOutput {
  rows: Record<string, string | number | null>[];
  charts: ChartSeries[];
  summary: Record<string, unknown>;
  notes?: string[];
}

/** Resolved year/term and a yyyy-MM-dd range (school tz, NFR-7) handed to every report. */
export interface ReportContext {
  tz: string;
  today: string;
  year: { id: string; name: string; start: string; end: string };
  term: { id: string; name: string; start: string; end: string } | null;
  /** Explicit filters.from/to, else the term (or year) clipped to today. */
  from: string;
  to: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function resolveContext(f: { academicYearId?: string; termId?: string; from?: string; to?: string }): Promise<ReportContext> {
  const tz = await getSchoolTimezone();
  const today = schoolDateOf(new Date(), tz);
  const termRow = f.termId ? await prisma.term.findUnique({ where: { id: f.termId } }) : null;
  if (f.termId && !termRow) throw new AppError('VALIDATION_ERROR', 'Unknown term.', { fieldErrors: { termId: ['Unknown term'] } });
  const yearId = termRow?.academicYearId ?? f.academicYearId;
  const year = await prisma.academicYear.findFirst({
    where: yearId ? { id: yearId } : { isCurrent: true },
    include: { terms: { orderBy: { order: 'asc' } } },
  });
  if (!year) throw new AppError(yearId ? 'VALIDATION_ERROR' : 'NOT_FOUND', yearId ? 'Unknown academic year.' : 'No current academic year.');
  const term =
    termRow ??
    year.terms.find((t) => day(t.startDate) <= today && today <= day(t.endDate)) ??
    (year.terms.filter((t) => day(t.endDate) < today).pop() || year.terms[0]) ??
    null;
  const start = term ? day(term.startDate) : day(year.startDate);
  const end = term ? day(term.endDate) : day(year.endDate);
  return {
    tz,
    today,
    year: { id: year.id, name: year.name, start: day(year.startDate), end: day(year.endDate) },
    term: term ? { id: term.id, name: term.name, start: day(term.startDate), end: day(term.endDate) } : null,
    from: f.from ?? start,
    to: f.to ?? (end < today ? end : today < start ? end : today),
  };
}

interface ReportDef<S extends z.ZodTypeAny> {
  title: string;
  description: string;
  filterSchema: S;
  columns: Column[];
  run: (filters: z.output<S>, ctx: ReportContext) => Promise<ReportOutput>;
}

const def = <S extends z.ZodTypeAny>(d: ReportDef<S>) => d;

export const REPORTS = {
  enrollment: def({ ...enrollment.report, filterSchema: enrollmentFilters }),
  attendance: def({ ...attendance.report, filterSchema: attendanceFilters }),
  performance: def({ ...performance.report, filterSchema: performanceFilters }),
  completion: def({ ...completion.report, filterSchema: completionFilters }),
  engagement: def({ ...engagement.report, filterSchema: engagementFilters }),
  workload: def({ ...workload.report, filterSchema: workloadFilters }),
} satisfies Record<ReportKey, unknown>;

export { REPORT_KEYS };

export const isReportKey = (key: string): key is ReportKey => (REPORT_KEYS as readonly string[]).includes(key);

/** Parse the query with the report's schema, resolve the period and run it → ReportResult. */
export async function runReport(key: string, query: Record<string, string | undefined>) {
  if (!isReportKey(key)) throw new AppError('NOT_FOUND', 'Report not found');
  const r = REPORTS[key] as unknown as ReportDef<z.ZodTypeAny>;
  const filters = r.filterSchema.parse(query) as { academicYearId?: string; termId?: string; from?: string; to?: string; format: 'json' | 'csv' };
  const ctx = await resolveContext(filters);
  const out = await r.run(filters, ctx);
  return {
    key,
    title: r.title,
    filters: { ...filters, academicYearId: ctx.year.id, termId: ctx.term?.id ?? null, from: ctx.from, to: ctx.to },
    columns: r.columns,
    rows: out.rows,
    charts: out.charts,
    summary: out.summary,
    notes: out.notes ?? [],
  };
}
export type ReportResult = Awaited<ReturnType<typeof runReport>>;
