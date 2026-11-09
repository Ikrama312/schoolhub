import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * SH-1 QA: client behaviour of the new auth forms. Only the network (fetch)
 * and framework boundaries (router, next-auth signIn) are stubbed.
 */
// userEvent typing into MUI fields is slow under full-suite parallel load.
vi.setConfig({ testTimeout: 30_000 });

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
const signIn = vi.fn();
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

import { ForgotPasswordForm } from '@/app/(auth)/forgot-password/ForgotPasswordForm';
import { TokenPasswordForm } from '@/app/(auth)/TokenPasswordForm';
import { ChangePasswordForm } from '@/app/(app)/account/security/ChangePasswordForm';
import { ToastProvider } from '@/components/Toast/ToastProvider';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

const GOOD = 'Brand-new-pass-77';
const INVALID = 'This invitation link is invalid or has expired. Ask the school office to send a new one.';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ForgotPasswordForm (FR-17)', () => {
  it('shows the server success copy without enumerating accounts', async () => {
    const copy = "If an account exists for that email, we've sent a reset link.";
    reply(200, { data: { message: copy } });
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/^Email/), 'nobody@schoolhub.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/forgot-password', expect.anything());
    expect(sentBody()).toEqual({ email: 'nobody@schoolhub.test' });
  });

  it('shows the rate-limit copy on 429 (FR-6/FR-17)', async () => {
    reply(429, { error: { code: 'RATE_LIMITED', message: 'x' } });
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@schoolhub.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a few minutes and try again.');
  });

  it('blocks an invalid email client-side, focusing the field (NFR-5, NFR-11)', async () => {
    render(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveFocus());
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TokenPasswordForm (FR-13, FR-14, FR-16, FR-19)', () => {
  it('invite: shows name/email read-only, a live checklist, and signs in to /dashboard', async () => {
    reply(200, { data: { ok: true } });
    signIn.mockResolvedValueOnce({ ok: true, error: undefined });
    render(
      <TokenPasswordForm mode="invite" token="raw-tok" email="new@schoolhub.test" name="New User" invalidMessage={INVALID} />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('New User');
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByRole('list', { name: 'Password requirements' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^New password/), GOOD);
    await userEvent.type(screen.getByLabelText(/^Confirm password/), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/accept-invite');
    expect(sentBody()).toEqual({ token: 'raw-tok', password: GOOD, confirm: GOOD });
    expect(signIn).toHaveBeenCalledWith('credentials', { email: 'new@schoolhub.test', password: GOOD, redirect: false });
  });

  it('invite: a 410 (used/expired token) swaps the form for the invalid-link message', async () => {
    reply(410, { error: { code: 'GONE', message: 'gone' } });
    render(<TokenPasswordForm mode="invite" token="t" email="x@schoolhub.test" invalidMessage={INVALID} />);
    await userEvent.type(screen.getByLabelText(/^New password/), GOOD);
    await userEvent.type(screen.getByLabelText(/^Confirm password/), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID);
    expect(screen.queryByRole('link', { name: 'Request a new reset link' })).not.toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('reset: success redirects to /login?reset=1 without signing in', async () => {
    reply(200, { data: { ok: true } });
    render(<TokenPasswordForm mode="reset" token="t" email="x@schoolhub.test" invalidMessage="bad" />);
    await userEvent.type(screen.getByLabelText(/^New password/), GOOD);
    await userEvent.type(screen.getByLabelText(/^Confirm password/), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reset=1'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/reset-password');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a policy-failing password client-side (FR-15)', async () => {
    render(<TokenPasswordForm mode="reset" token="t" email="x@schoolhub.test" invalidMessage="bad" />);
    await userEvent.type(screen.getByLabelText(/^New password/), 'short1');
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'short1');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'true'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordForm (FR-20)', () => {
  const renderForm = () =>
    render(
      <ToastProvider>
        <ChangePasswordForm email="me@schoolhub.test" />
      </ToastProvider>,
    );
  const fill = async (current: string) => {
    await userEvent.type(screen.getByLabelText(/^Current password/), current);
    await userEvent.type(screen.getByLabelText(/^New password/), GOOD);
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
  };

  it('maps the server currentPassword error onto the field', async () => {
    reply(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        details: { fieldErrors: { currentPassword: ['Current password is incorrect.'] } },
      },
    });
    renderForm();
    await fill('wrong-current-1');
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Current password/)).toHaveAttribute('aria-invalid', 'true');
  });

  it("maps the server's `password` policy error onto New password", async () => {
    reply(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: { fieldErrors: { password: ['Too common.'] } } },
    });
    renderForm();
    await fill('Current-pass-1');
    expect(await screen.findByText('Too common.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'true');
  });

  it("success shows the 'Password updated' toast and clears the form", async () => {
    reply(200, { data: { ok: true } });
    renderForm();
    await fill('Current-pass-1');
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/account/password');
    expect(sentBody()).toEqual({ currentPassword: 'Current-pass-1', newPassword: GOOD, confirm: GOOD });
    await waitFor(() => expect(screen.getByLabelText(/^Current password/)).toHaveValue(''));
    expect(refresh).toHaveBeenCalled();
  });
});
