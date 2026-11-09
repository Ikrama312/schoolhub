import type { Grade, GradeCategory, GradeItem, GradingScale, TermGradeOverride } from '@prisma/client';
import { prisma } from '@/server/db';
import { computeStudentTerm, effectiveScale, type CalcBand, type CalcGrade, type StudentTermResult } from './grade-calc';

/**
 * PRD-11 shared batched loader (NFR-2, NFR-3): a fixed number of findMany calls with `in`
 * filters regardless of how many courses/students, grouped in memory. Used by the gradebook,
 * student grades and report-card generation.
 */

export type ScaleRow = Pick<GradingScale, 'id' | 'name' | 'isDefault'> & { bands: CalcBand[] };

export interface CourseTermData {
  items: Map<string, GradeItem[]>;
  categories: Map<string, GradeCategory[]>;
  scales: Map<string, ScaleRow | null>;
  defaultScale: ScaleRow | null;
  allScales: ScaleRow[];
  /** itemId → studentId → grade */
  grades: Map<string, Map<string, Grade>>;
  /** `${courseId}:${studentId}` → override */
  overrides: Map<string, TermGradeOverride>;
}

const toScale = (s: GradingScale): ScaleRow => ({ id: s.id, name: s.name, isDefault: s.isDefault, bands: s.bands as unknown as CalcBand[] });

export async function loadScales() {
  const rows = await prisma.gradingScale.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  const all = rows.map(toScale);
  return { all, defaultScale: all.find((s) => s.isDefault) ?? null };
}

export async function loadCourseTermData(
  courseIds: string[],
  termId: string,
  studentIds?: string[],
  { visibleOnly = false }: { visibleOnly?: boolean } = {},
): Promise<CourseTermData> {
  const [courses, items, categories, overrides, scales] = await Promise.all([
    prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, gradingScaleId: true } }),
    prisma.gradeItem.findMany({
      where: { courseId: { in: courseIds }, termId, ...(visibleOnly ? { isVisible: true } : {}) },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
    }),
    prisma.gradeCategory.findMany({ where: { courseId: { in: courseIds } }, orderBy: { order: 'asc' } }),
    prisma.termGradeOverride.findMany({ where: { courseId: { in: courseIds }, termId, ...(studentIds ? { studentId: { in: studentIds } } : {}) } }),
    loadScales(),
  ]);
  const grades = items.length
    ? await prisma.grade.findMany({ where: { gradeItemId: { in: items.map((i) => i.id) }, ...(studentIds ? { studentId: { in: studentIds } } : {}) } })
    : [];

  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const byId = new Map(scales.all.map((s) => [s.id, s]));
  const gradeMap = new Map<string, Map<string, Grade>>();
  for (const g of grades) {
    if (!gradeMap.has(g.gradeItemId)) gradeMap.set(g.gradeItemId, new Map());
    gradeMap.get(g.gradeItemId)!.set(g.studentId, g);
  }
  return {
    items: group(items, (i) => i.courseId),
    categories: group(categories, (c) => c.courseId),
    scales: new Map(courses.map((c) => [c.id, effectiveScale(c.gradingScaleId ? byId.get(c.gradingScaleId) : null, scales.defaultScale)])),
    defaultScale: scales.defaultScale,
    allScales: scales.all,
    grades: gradeMap,
    overrides: new Map(overrides.map((o) => [`${o.courseId}:${o.studentId}`, o])),
  };
}

export function studentGrades(data: CourseTermData, items: readonly GradeItem[], studentId: string): Map<string, CalcGrade> {
  const m = new Map<string, CalcGrade>();
  for (const i of items) {
    const g = data.grades.get(i.id)?.get(studentId);
    if (g) m.set(i.id, g);
  }
  return m;
}

/** The single calc call every consumer shares (FR-15). */
export function computeCourseResult(data: CourseTermData, courseId: string, studentId: string, now: Date): StudentTermResult {
  const items = data.items.get(courseId) ?? [];
  return computeStudentTerm({
    items,
    grades: studentGrades(data, items, studentId),
    categories: data.categories.get(courseId) ?? [],
    bands: data.scales.get(courseId)?.bands ?? [],
    override: data.overrides.get(`${courseId}:${studentId}`) ?? null,
    now,
  });
}
