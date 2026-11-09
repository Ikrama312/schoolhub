import { describe, it, expect } from 'vitest';
import {
  passwordChecks,
  safeCallbackUrl,
  signInSchema,
  acceptInviteSchema,
  changePasswordSchema,
} from '@/lib/validators/auth';

describe('passwordChecks', () => {
  it('passes a compliant password', () => {
    expect(passwordChecks('correcthorse9', 'a@b.test')).toEqual({ length: true, letter: true, digit: true, notEmail: true });
  });

  it('enforces 10..128 length', () => {
    expect(passwordChecks('abc123456', 'x@y.z').length).toBe(false);
    expect(passwordChecks('abc1234567', 'x@y.z').length).toBe(true);
    expect(passwordChecks('a1'.repeat(64), 'x@y.z').length).toBe(true);
    expect(passwordChecks('a1'.repeat(64) + 'b', 'x@y.z').length).toBe(false);
  });

  it('requires a letter and a digit', () => {
    expect(passwordChecks('1234567890', 'x@y.z').letter).toBe(false);
    expect(passwordChecks('abcdefghij', 'x@y.z').digit).toBe(false);
  });

  it('rejects the email, case-insensitively', () => {
    expect(passwordChecks('Teacher1@School.test', 'teacher1@school.test').notEmail).toBe(false);
  });
});

describe('safeCallbackUrl', () => {
  it('keeps relative paths', () => {
    expect(safeCallbackUrl('/courses/1?tab=roster')).toBe('/courses/1?tab=roster');
  });

  it.each(['//evil.com', '/\\evil', 'https://evil.com', '', null, undefined, 'dashboard'])('rejects %s', (url) => {
    expect(safeCallbackUrl(url as string | null)).toBe('/dashboard');
  });
});

describe('schemas', () => {
  it('trims and lower-cases the sign-in email', () => {
    expect(signInSchema.parse({ email: '  Admin@SchoolHub.TEST ', password: 'x' }).email).toBe('admin@schoolhub.test');
  });

  it('flags a confirm mismatch and policy failures', () => {
    const result = acceptInviteSchema.safeParse({ token: 't', password: 'short', confirm: 'other' });
    expect(result.success).toBe(false);
    const fields = result.success ? {} : result.error.flatten().fieldErrors;
    expect(fields.password?.length).toBeGreaterThan(0);
    expect(fields.confirm).toEqual(['Passwords do not match.']);
  });

  it('accepts a valid change-password body', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'newpassword42', confirm: 'newpassword42' }).success,
    ).toBe(true);
  });
});
