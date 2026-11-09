import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from '@/app/(auth)/login/LoginForm';

describe('loginErrorMessage', () => {
  it('shows the remaining lockout minutes', () => {
    expect(loginErrorMessage('locked:7')).toBe('This account is temporarily locked. Try again in 7 minutes.');
  });

  it('maps disabled and rate_limited', () => {
    expect(loginErrorMessage('disabled')).toBe('This account is disabled. Contact the school office.');
    expect(loginErrorMessage('rate_limited')).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('falls back to the generic message', () => {
    for (const code of ['invalid', 'locked:', 'something-else', '', null, undefined]) {
      expect(loginErrorMessage(code)).toBe('Email or password is incorrect.');
    }
  });
});
