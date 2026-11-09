/**
 * Paths reachable without a session (FR-12). A trailing '/' means prefix
 * match. There is deliberately no sign-up path: accounts are admin-created.
 */
export const PUBLIC_PAGE_PATHS = ['/', '/login', '/forgot-password', '/invite/', '/reset-password/'];
// '/api/internal/' is gated by its own CRON_SECRET bearer check (PRD-04 NFR-8), not a session.
// '/api/files/' (PRD-08 D1): GET runs the file access registry (the logo is public);
// POST/DELETE call requireUser() themselves.
export const PUBLIC_API_PATHS = ['/api/health', '/api/auth/', '/api/internal/', '/api/files/'];

export function isPublicPath(pathname: string): boolean {
  return [...PUBLIC_PAGE_PATHS, ...PUBLIC_API_PATHS].some((p) =>
    p.endsWith('/') && p !== '/' ? pathname.startsWith(p) : pathname === p,
  );
}
