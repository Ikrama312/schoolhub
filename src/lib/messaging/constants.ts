/** PRD-13 limits shared by validators, services and the client (FR-11, FR-13, FR-15). Client-safe. */
export const BODY_MAX = 5000;
export const COUNTER_FROM = 4500;
export const MAX_FILES = 5;
export const MAX_PARTICIPANTS = 25;
export const SUBJECT_MAX = 120;
export const REASON_MAX = 1000;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const THREAD_POLL_MS = 5000;
export const LIST_POLL_MS = 30000;
export const PAGE_SIZE = 30;
export const RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;
export const EMAIL_DELAY_MS = 10 * 60_000;
export const DELETED_TEXT = 'This message was deleted';
