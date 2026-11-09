import { ALL_ROLES, type Role } from './navigation';

export interface CourseTab {
  key: string;
  label: string;
  href: (courseId: string) => string;
  roles: Role[];
}

/**
 * Course home tabs (mirrors student-tabs.ts). Later PRDs (content,
 * assignments, gradebook...) register their tab here.
 */
export const courseTabs: CourseTab[] = [
  { key: 'overview', label: 'Overview', href: (id) => `/courses/${id}`, roles: ALL_ROLES },
  { key: 'roster', label: 'Roster', href: (id) => `/courses/${id}/roster`, roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
  { key: 'assignments', label: 'Assignments', href: (id) => `/courses/${id}/assignments`, roles: ALL_ROLES },
  { key: 'quizzes', label: 'Quizzes', href: (id) => `/courses/${id}/quizzes`, roles: ALL_ROLES },
  { key: 'attendance', label: 'Attendance', href: (id) => `/courses/${id}/attendance`, roles: ['TEACHER', 'ADMIN'] },
  // PRD-11 FR-18 / FR-28
  { key: 'gradebook', label: 'Gradebook', href: (id) => `/courses/${id}/gradebook`, roles: ['ADMIN', 'TEACHER'] },
  { key: 'grades', label: 'Grades', href: (id) => `/courses/${id}/grades`, roles: ['STUDENT', 'PARENT'] },
];
