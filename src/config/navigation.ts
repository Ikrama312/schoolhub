import type { ComponentType } from 'react';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import ClassOutlinedIcon from '@mui/icons-material/ClassOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GradingOutlinedIcon from '@mui/icons-material/GradingOutlined';
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined';
import StraightenOutlinedIcon from '@mui/icons-material/StraightenOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import FamilyRestroomOutlinedIcon from '@mui/icons-material/FamilyRestroomOutlined';
import SickOutlinedIcon from '@mui/icons-material/SickOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType;
  roles: Role[];
  /** Sidebar subheader; consecutive items sharing a group render under one heading (PRD-05 Decision 1). */
  group?: string;
  /** PRD-13 FR-18: the shell renders a live badge for this key. */
  badge?: 'messages';
  /** PRD-13 FR-23: hidden unless the flag is set (the page still enforces access itself). */
  requires?: 'safeguardingLead' | 'homeroom';
}

export interface NavFlags {
  safeguardingLead?: boolean;
  /** PRD-15 FR-42: TEACHER with a current-year homeroom section. */
  homeroom?: boolean;
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
  // PRD-16 FR-40
  { label: 'Reports', href: '/admin/reports', icon: AssessmentOutlinedIcon, roles: ['ADMIN'] },
  { label: 'At-risk students', href: '/insights/at-risk', icon: WarningAmberOutlinedIcon, roles: ['ADMIN', 'TEACHER'] },
  // PRD-15 FR-42. The parent "Absence notes" entry lands on /attendance/absence-notes, which redirects to the selected child's list.
  { label: 'My children', href: '/my-children', icon: FamilyRestroomOutlinedIcon, roles: ['PARENT'] },
  { label: 'Absence notes', href: '/attendance/absence-notes', icon: SickOutlinedIcon, roles: ['PARENT', 'ADMIN'] },
  { label: 'Absence notes', href: '/attendance/absence-notes', icon: SickOutlinedIcon, roles: ['TEACHER'], requires: 'homeroom' },
  { label: 'Conferences', href: '/conferences', icon: EventAvailableOutlinedIcon, roles: ['PARENT', 'TEACHER'] },
  { label: 'Consent forms', href: '/consent-forms', icon: DrawOutlinedIcon, roles: ['PARENT', 'ADMIN'] },
  { label: 'Notifications', href: '/notifications', icon: NotificationsNoneIcon, roles: ALL_ROLES },
  { label: 'Messages', href: '/messages', icon: ChatBubbleOutlineIcon, roles: ALL_ROLES, badge: 'messages' },
  { label: 'My courses', href: '/my-courses', icon: MenuBookOutlinedIcon, roles: ['TEACHER', 'STUDENT', 'PARENT'] },
  { label: 'Assignments', href: '/assignments', icon: AssignmentOutlinedIcon, roles: ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN'] },
  { label: 'Grades', href: '/grades', icon: GradingOutlinedIcon, roles: ['STUDENT', 'PARENT'] },
  { label: 'Attendance', href: '/attendance/take', icon: FactCheckOutlinedIcon, roles: ['TEACHER'] },
  { label: 'Report cards', href: '/report-cards', icon: WorkspacePremiumOutlinedIcon, roles: ['TEACHER'] },
  { label: 'Attendance', href: '/admin/attendance', icon: FactCheckOutlinedIcon, roles: ['ADMIN'] },
  { label: 'Email log', href: '/admin/email-log', icon: MarkEmailUnreadOutlinedIcon, roles: ['ADMIN'] },
  { label: 'Conferences', href: '/admin/conferences', icon: EventAvailableOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Sections', href: '/admin/sections', icon: GroupsOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Courses', href: '/admin/courses', icon: ClassOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Grading scales', href: '/admin/grading-scales', icon: StraightenOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Report cards', href: '/admin/report-cards', icon: WorkspacePremiumOutlinedIcon, roles: ['ADMIN'], group: 'Administration' },
  { label: 'Safeguarding', href: '/admin/safeguarding', icon: ShieldOutlinedIcon, roles: ['ADMIN'], requires: 'safeguardingLead', group: 'Administration' },
];

export function navigationForRole(role: Role, flags: NavFlags = {}): NavItem[] {
  return navigation.filter((item) => item.roles.includes(role) && (!item.requires || flags[item.requires]));
}
