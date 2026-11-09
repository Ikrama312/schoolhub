import { describe, it, expect } from 'vitest';
import { assertPasswordAllowed } from '@/server/auth/password-policy';
import { AppError } from '@/server/http';

function errorsFor(password: string, email = 'user@schoolhub.test'): string[] {
  try {
    assertPasswordAllowed(password, email);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_ERROR');
    return (error as AppError & { details: { fieldErrors: { password: string[] } } }).details.fieldErrors.password;
  }
}

describe('assertPasswordAllowed', () => {
  it('accepts a compliant, uncommon password (incl. the seed password)', () => {
    expect(errorsFor('Correct9horse')).toEqual([]);
    expect(errorsFor('SchoolHub123!')).toEqual([]);
  });

  it('rejects short, letterless, digitless and email passwords', () => {
    expect(errorsFor('abc12')).toContain('Password must be 10 to 128 characters.');
    expect(errorsFor('1234567890123')).toContain('Password must contain at least one letter.');
    expect(errorsFor('abcdefghijkl')).toContain('Password must contain at least one number.');
    expect(errorsFor('User1@schoolhub.test', 'user1@schoolhub.test')).toContain('Password must not be your email address.');
  });

  it('rejects common passwords case-insensitively', () => {
    expect(errorsFor('password123')).toContain('This password is too common. Choose another.');
    expect(errorsFor('PassWord123')).toContain('This password is too common. Choose another.');
  });
});
