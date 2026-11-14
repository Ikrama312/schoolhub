// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { renderEmail } from '@/server/email/render';

/**
 * QA SH-17 finding (pre-existing platform defect): @react-email/render 1.0.1 decodes stream chunks
 * without { stream: true }, so a multi-byte preview-padding char split across a chunk boundary
 * becomes U+0000. Postgres then rejects the EmailOutbox row and notify() swallows the error. In-app
 * notifications still arrive; the email is lost. Fee titles such as
 * "Fee reminder: invoice INV-2026-000123 for <student name>" often fall into the failing length range.
 * `it.fails` keeps the suite green and flips to red once the renderer is fixed, so remove `.fails` then.
 */
const school = { name: 'SchoolHub Academy', shortName: 'SHA', logoUrl: null, addressLine1: null, addressLine2: null };

describe('generic-notification email render', () => {
  it.fails('never contains a NUL byte for fee reminder titles (FR-36/FR-37/FR-38 email channel)', async () => {
    const title = 'Fee reminder: invoice INV-2026-000123 for Alexandra Smith';
    const { html } = await renderEmail('generic-notification', { title, body: 'Balance $1,240.00, due 2026-11-30.', link: '/fees' }, school);
    expect(html.includes('\0')).toBe(false);
  });

  it('short titles render cleanly (control)', async () => {
    const { html } = await renderEmail('generic-notification', { title: 'Payment received', body: 'b', link: '/fees' }, school);
    expect(html.includes('\0')).toBe(false);
  });
});
