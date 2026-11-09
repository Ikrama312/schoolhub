/**
 * Notification type registry (PRD-04 FR-2..5). Client-safe: no prisma/env
 * imports, so validators and client pages can import it. Later PRDs add keys
 * to NOTIFICATION_TYPES; there is no runtime registration API.
 */
export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

const ALL: readonly Role[] = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];

export const NOTIFICATION_CATEGORIES = ['ACCOUNT', 'ACADEMIC', 'ATTENDANCE', 'COMMUNICATION', 'FINANCE', 'SYSTEM'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ACCOUNT: 'Account',
  ACADEMIC: 'Academic',
  ATTENDANCE: 'Attendance',
  COMMUNICATION: 'Communication',
  FINANCE: 'Finance',
  SYSTEM: 'System',
};

export type NotificationTypeDef = {
  label: string;
  description: string;
  category: NotificationCategory;
  defaultEmail: boolean;
  mandatoryInApp: boolean;
  roles: readonly Role[];
  /** Sent straight to the outbox (sendAuthEmail); hidden from preferences. */
  emailOnly?: true;
};

export const NOTIFICATION_TYPES = {
  'account.invite': {
    label: 'Account invitation',
    description: 'Invitation to set up your SchoolHub account.',
    category: 'ACCOUNT',
    defaultEmail: true,
    mandatoryInApp: false,
    emailOnly: true,
    roles: ALL,
  },
  'account.password_reset': {
    label: 'Password reset',
    description: 'Link to reset your password.',
    category: 'ACCOUNT',
    defaultEmail: true,
    mandatoryInApp: false,
    emailOnly: true,
    roles: ALL,
  },
  'system.test': {
    label: 'Test notification',
    description: 'Test messages sent by an administrator.',
    category: 'SYSTEM',
    defaultEmail: true,
    mandatoryInApp: false,
    roles: ALL,
  },
  // PRD-07 attendance (FR-20, FR-23).
  'attendance.absent': {
    label: 'Marked absent',
    description: 'A student was marked absent from a class or the daily register.',
    category: 'ATTENDANCE',
    defaultEmail: true,
    mandatoryInApp: true,
    roles: ['PARENT', 'STUDENT'],
  },
  'attendance.late': {
    label: 'Marked late',
    description: 'A student was marked late.',
    category: 'ATTENDANCE',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['PARENT', 'STUDENT'],
  },
  'attendance.corrected': {
    label: 'Attendance corrected',
    description: 'An absence was corrected to present.',
    category: 'ATTENDANCE',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['PARENT', 'STUDENT'],
  },
  'attendance.register_missing': {
    label: 'Register not taken',
    description: 'An administrator reminded you to take a register.',
    category: 'ATTENDANCE',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['TEACHER'],
  },
  // PRD-08 course content (FR-38). Scheduled lessons never notify (FR-39).
  'content.lesson_published': {
    label: 'New lesson published',
    description: 'A teacher published a new lesson in one of your courses.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT'],
  },
  // PRD-09 assignments (FR-42..FR-46).
  'assignment.published': {
    label: 'New assignment',
    description: 'A teacher published an assignment in one of your courses.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT'],
  },
  'assignment.due_soon': {
    label: 'Assignment due soon',
    description: 'An assignment you have not submitted is due within 24 hours.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT'],
  },
  'assignment.returned': {
    label: 'Assignment returned',
    description: 'Graded work was returned with a score and feedback.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT', 'PARENT'],
  },
  'assignment.missing': {
    label: 'Missing assignment',
    description: 'Your child has not submitted an assignment that was due over 24 hours ago.',
    category: 'ACADEMIC',
    defaultEmail: true,
    mandatoryInApp: false,
    roles: ['PARENT'],
  },
  // PRD-10 quizzes (FR-29, FR-30). results_released defaults to email like assignment grading (A5).
  'quiz.published': {
    label: 'New quiz',
    description: 'A teacher published a quiz in one of your courses.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT'],
  },
  'quiz.results_released': {
    label: 'Quiz results released',
    description: 'Results for a quiz you took are now available.',
    category: 'ACADEMIC',
    defaultEmail: true,
    mandatoryInApp: false,
    roles: ['STUDENT', 'PARENT'],
  },
  // PRD-11 gradebook (FR-38). grade.posted fires once per student per manual item (A9).
  'grade.posted': {
    label: 'Grade posted',
    description: 'A teacher entered a grade for an in-class or offline item.',
    category: 'ACADEMIC',
    defaultEmail: false,
    mandatoryInApp: false,
    roles: ['STUDENT', 'PARENT'],
  },
  'report_card.published': {
    label: 'Report card published',
    description: 'A term report card is available to view and print.',
    category: 'ACADEMIC',
    defaultEmail: true,
    mandatoryInApp: false,
    roles: ['STUDENT', 'PARENT'],
  },
} as const satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

const entries = Object.entries(NOTIFICATION_TYPES) as [NotificationType, NotificationTypeDef][];

export function getTypeDef(type: string): NotificationTypeDef | undefined {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type)
    ? (NOTIFICATION_TYPES as Record<string, NotificationTypeDef>)[type]
    : undefined;
}

/** Types a role may see and configure (FR-28, FR-37): role match, not emailOnly. */
export function visibleTypesFor(role: Role): NotificationType[] {
  return entries.filter(([, def]) => def.roles.includes(role) && !def.emailOnly).map(([key]) => key);
}

/** Type keys in a category, for the FR-34 list filter. */
export function typesInCategory(category: NotificationCategory): NotificationType[] {
  return entries.filter(([, def]) => def.category === category).map(([key]) => key);
}

export function categoryOf(type: string): NotificationCategory | null {
  return getTypeDef(type)?.category ?? null;
}
