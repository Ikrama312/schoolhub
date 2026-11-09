import { ALL_ROLES, type Role } from './navigation';

export interface StudentTab {
  key: string;
  label: string;
  href: (studentId: string) => string;
  roles: Role[];
}

/** Extension point for the student detail page; later PRDs register their tab here. */
export const studentTabs: StudentTab[] = [
  { key: 'courses', label: 'Courses', href: (id) => `/students/${id}/courses`, roles: ALL_ROLES },
  { key: 'attendance', label: 'Attendance', href: (id) => `/students/${id}/attendance`, roles: ALL_ROLES },
  // PRD-09 FR-41. No tab bar renders studentTabs yet, so the page is reachable by URL only.
  { key: 'assignments', label: 'Assignments', href: (id) => `/students/${id}/assignments`, roles: ALL_ROLES },
];
