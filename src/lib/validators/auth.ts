import { z } from 'zod';

/**
 * Client-safe auth validators (FR-2, FR-8, FR-17). No fs / server imports:
 * the login/invite/reset/security forms import this directly. The
 * common-password rule and the real "not your email" check run server-side
 * in src/server/auth/password-policy.ts (the API body doesn't carry the email).
 */

export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address');

export interface PasswordCheckResult {
  length: boolean;
  letter: boolean;
  digit: boolean;
  notEmail: boolean;
}

export const PASSWORD_RULES: Record<keyof PasswordCheckResult, { label: string; error: string }> = {
  length: { label: '10 to 128 characters', error: 'Password must be 10 to 128 characters.' },
  letter: { label: 'At least one letter', error: 'Password must contain at least one letter.' },
  digit: { label: 'At least one number', error: 'Password must contain at least one number.' },
  notEmail: { label: 'Not the same as your email', error: 'Password must not be your email address.' },
};

export function passwordChecks(password: string, email: string): PasswordCheckResult {
  return {
    length: password.length >= 10 && password.length <= 128,
    letter: /[A-Za-z]/.test(password),
    digit: /[0-9]/.test(password),
    notEmail: password.trim().toLowerCase() !== email.trim().toLowerCase(),
  };
}

/** Error messages for every failing rule (empty when the password passes). */
export function passwordErrors(password: string, email: string): string[] {
  const checks = passwordChecks(password, email);
  return (Object.keys(checks) as (keyof PasswordCheckResult)[])
    .filter((key) => !checks[key])
    .map((key) => PASSWORD_RULES[key].error);
}

/** FR-8: only same-origin relative paths; everything else falls back to /dashboard. */
export function safeCallbackUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return '/dashboard';
  return url;
}

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
});

export const forgotPasswordSchema = z.object({ email: emailField });

/** superRefine: policy rules on `field` + confirm-equals. `email` is '' when unknown. */
function refineNewPassword(field: string, email = '') {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const password = String(value[field] ?? '');
    for (const message of passwordErrors(password, email)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
    if (password !== value.confirm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm'], message: 'Passwords do not match.' });
    }
  };
}

const newPasswordShape = { password: z.string(), confirm: z.string() };

/** Client form schema for SetPasswordForm (invite + reset); pass the known email. */
export function setPasswordSchema(email = '') {
  return z.object(newPasswordShape).superRefine(refineNewPassword('password', email));
}

export const acceptInviteSchema = z
  .object({ token: z.string().min(1), ...newPasswordShape })
  .superRefine(refineNewPassword('password'));

export const resetPasswordSchema = acceptInviteSchema;

export function changePasswordFormSchema(email = '') {
  return z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password'),
      newPassword: z.string(),
      confirm: z.string(),
    })
    .superRefine(refineNewPassword('newPassword', email));
}

export const changePasswordSchema = changePasswordFormSchema();

export type SignInInput = z.infer<typeof signInSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetPasswordValues = z.infer<ReturnType<typeof setPasswordSchema>>;
