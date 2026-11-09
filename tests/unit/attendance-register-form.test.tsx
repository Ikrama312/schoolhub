import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** SH-7 QA: RegisterForm client behaviour (FR-9..13, FR-17, NFR-2, NFR-9). Only fetch and the router are stubbed. */
vi.setConfig({ testTimeout: 30_000 });

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { RegisterForm } from '@/app/(app)/attendance/take/RegisterForm';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import type { Register } from '@/server/attendance/attendance-service';

const fetchMock = vi.fn();
const key = { courseId: 'c1', periodId: 'p1', date: '2026-11-06' };
const DRAFT = 'attendance-draft:c1:2026-11-06:p1';

function register(over: Partial<Register> = {}): Register {
  return {
    key,
    header: { courseName: 'Maths', sectionName: '7A', periodName: 'P1', date: key.date },
    sessionId: null,
    students: [
      { id: 's1', firstName: 'Ann', lastName: 'Able', avatarUrl: null },
      { id: 's2', firstName: 'Bob', lastName: 'Baker', avatarUrl: null },
      { id: 's3', firstName: 'Cat', lastName: 'Cole', avatarUrl: null },
    ],
    records: [],
    takenBy: null,
    updatedBy: null,
    updatedAt: null,
    readOnly: false,
    readOnlyReason: null,
    canExcuse: false,
    ...over,
  } as Register;
}

const ui = (r = register()) => render(<ToastProvider><RegisterForm initial={r} /></ToastProvider>);
const btn = (name: string) => screen.getByRole('button', { name });
const save = () => screen.getByRole('button', { name: /^save$/i });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('RegisterForm', () => {
  it('FR-9/FR-13: nothing selected by default, counters live, Save disabled until all marked', async () => {
    const user = userEvent.setup();
    ui();
    for (const n of ['Ann Able', 'Bob Baker', 'Cat Cole']) {
      for (const w of ['present', 'absent', 'late']) expect(btn(`Mark ${n} ${w}`)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByText('Unmarked 3')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.click(btn('Mark Ann Able absent'));
    expect(screen.getByText('Absent 1')).toBeInTheDocument();
    expect(screen.getByText('Unmarked 2')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('FR-11: Mark all present fills only unselected rows', async () => {
    const user = userEvent.setup();
    ui();
    await user.click(btn('Mark Ann Able absent'));
    await user.click(btn('Mark all present'));
    expect(btn('Mark Ann Able absent')).toHaveAttribute('aria-pressed', 'true');
    expect(btn('Mark Bob Baker present')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Present 2')).toBeInTheDocument();
    expect(screen.getByText('Unmarked 0')).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('FR-10: EXCUSED disabled for teachers, enabled for admins', () => {
    const { unmount } = ui();
    expect(btn('Mark Ann Able excused')).toBeDisabled();
    unmount();
    ui(register({ canExcuse: true }));
    expect(btn('Mark Ann Able excused')).toBeEnabled();
  });

  it('FR-12: L reveals minutes-late (default 5) and the note sits behind an icon; PUT body carries both', async () => {
    const user = userEvent.setup();
    ui();
    expect(screen.queryByLabelText('Minutes late for Ann Able')).not.toBeInTheDocument();
    await user.click(btn('Mark Ann Able late'));
    expect(screen.getByLabelText('Minutes late for Ann Able')).toHaveValue(5);
    expect(screen.queryByLabelText('Note for Ann Able')).not.toBeInTheDocument();
    await user.click(btn('Add note for Ann Able'));
    const note = screen.getByLabelText('Note for Ann Able');
    expect(note).toHaveAttribute('maxlength', '500');
    await user.type(note, 'bus');
    await user.click(btn('Mark all present'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: register() }), { status: 200 }));
    await user.click(save());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ ...key, records: [{ studentId: 's1', status: 'LATE', minutesLate: 5, note: 'bus' }, { studentId: 's2', status: 'PRESENT' }, { studentId: 's3', status: 'PRESENT' }] });
    expect(body.records[1]).not.toHaveProperty('minutesLate');
  });

  it('FR-12: out-of-range minutes-late is blocked client-side', async () => {
    const user = userEvent.setup();
    ui();
    await user.click(btn('Mark Ann Able late'));
    const mins = screen.getByLabelText('Minutes late for Ann Able');
    await user.clear(mins);
    await user.type(mins, '241');
    await user.click(btn('Mark all present'));
    await user.click(save());
    expect(await screen.findByText(/Minutes late must be 1–240/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('NFR-2: a network failure keeps the marks in localStorage and the next open offers Restore', async () => {
    const user = userEvent.setup();
    const { unmount } = ui();
    await user.click(btn('Mark Bob Baker absent'));
    await user.click(btn('Mark all present'));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(save());
    await waitFor(() => expect(localStorage.getItem(DRAFT)).not.toBeNull());
    unmount();

    ui();
    expect(await screen.findByText('Restore unsaved attendance?')).toBeInTheDocument();
    await user.click(btn('Restore'));
    expect(btn('Mark Bob Baker absent')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Unmarked 0')).toBeInTheDocument();
  });

  it('FR-14/FR-19: read-only register explains why, disables input and shows last change', () => {
    ui(register({
      readOnly: true,
      readOnlyReason: 'Teachers can edit registers up to 14 days after the register date',
      records: [{ studentId: 's1', status: 'PRESENT' }, { studentId: 's2', status: 'PRESENT' }, { studentId: 's3', status: 'ABSENT' }],
      updatedBy: { id: 't', name: 'Tom Teacher' },
      updatedAt: '2026-10-01T09:00:00.000Z',
    }));
    expect(screen.getByText(/up to 14 days/)).toBeInTheDocument();
    expect(screen.getByText(/Last changed by Tom Teacher/)).toBeInTheDocument();
    expect(btn('Mark Cat Cole present')).toBeDisabled();
    expect(save()).toBeDisabled();
  });

  it('FR-17/NFR-9: toggles and note button are 44px targets with SR labels; save bar is sticky', () => {
    ui();
    const group = screen.getByRole('group', { name: 'Attendance for Ann Able' });
    for (const b of within(group).getAllByRole('button')) {
      const s = getComputedStyle(b);
      expect(s.minWidth).toBe('44px');
      expect(s.minHeight).toBe('44px');
      expect(b).toHaveAccessibleName(/^Mark Ann Able /);
    }
    expect(getComputedStyle(btn('Add note for Ann Able')).width).toBe('44px');
    const bar = save().closest('.MuiPaper-root')!;
    expect(getComputedStyle(bar).position).toBe('sticky');
  });
});
