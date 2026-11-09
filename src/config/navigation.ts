import type { ComponentType } from 'react';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType;
  roles: Role[];
  /** Sidebar subheader; consecutive items sharing a group render under one heading (PRD-05 Decision 1). */
  group?: string;
}

// Exported (PRD-04 TASK-3) so route handlers can call
// requireRole(...ALL_ROLES) as the stand-in for PRD-01's not-yet-landed
// requireUser() -- see system-design.md's Component 12.
export const ALL_ROLES: Role[] = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];

/**
 * Sidebar source of truth. A later PRD that adds a page adds its entry here
 * instead of hard-coding links in the shell.
 */
export const navigation: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: DashboardOutlinedIcon, roles: ALL_ROLES },
  { label: 'Notifications', href: '/notifications', icon: NotificationsNoneIcon, roles: ALL_ROLES },
  { label: 'My courses', href: '/my-courses', icon: MenuBookOutlinedIcon, roles: ['TEACHER', 'STUDENT', 'PARENT'] },
  { label: 'Assignments', href: '/assignments', icon: AssignmentOutlinedIcon, roles: ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN'] },
  { label: 'Attendance', href: '/attendance/take', icon: FactCheckOutlinedIcon, roles: ['TEACHER'] },
  { label: 'Attendance', href: '/admin/attendance', icon: FactCheckOutlinedIcon, roles: ['ADMIN'] },
  { label: 'Email log', href: '/admin/email-log', icon: MarkEmailUnreadOutlinedIcon, roles: ['ADMIN'] },
  { label: 'Sections', href: '/admin/sections', icon: GroupsOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Courses', href: '/admin/courses', icon: ClassOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
];

export function navigationForRole(role: Role): NavItem[] {
  return navigation.filter((item) => item.roles.includes(role));
}
