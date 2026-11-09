import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@/server/http';
import { passwordErrors } from '@/lib/validators/auth';

/**
 * Server-only password policy (FR-17, ADR-7). Never import from client code:
 * it reads the common-password list from disk.
 */
const COMMON = new Set(
  fs
    .readFileSync(path.join(process.cwd(), 'src/server/auth/common-passwords.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean),
);

export function assertPasswordAllowed(password: string, email: string): void {
  const errors = passwordErrors(password, email);
  if (COMMON.has(password.toLowerCase())) errors.push('This password is too common. Choose another.');
  if (errors.length) {
    throw new AppError('VALIDATION_ERROR', 'Password does not meet the requirements.', {
      fieldErrors: { password: errors },
    });
  }
}
