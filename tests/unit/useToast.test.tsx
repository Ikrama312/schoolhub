import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { useToast } from '@/components/Toast/useToast';

function Trigger() {
  const { showToast } = useToast();
  return (
    <>
      <button onClick={() => showToast({ message: 'First toast', severity: 'success' })}>show-1</button>
      <button onClick={() => showToast({ message: 'Second toast', severity: 'error' })}>show-2</button>
    </>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useToast / ToastProvider', () => {
  it('throws when used outside a ToastProvider', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });

  it('shows a toast with the given message and severity', () => {
    renderWithProvider();
    act(() => screen.getByText('show-1').click());
    expect(screen.getByText('First toast')).toBeInTheDocument();
  });

  it('queues a second toast instead of showing both at once', () => {
    renderWithProvider();
    act(() => screen.getByText('show-1').click());
    act(() => screen.getByText('show-2').click());
    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.queryByText('Second toast')).not.toBeInTheDocument();
  });

  it('auto-hides after 5 seconds and advances the queue to the next toast', async () => {
    // MUI's exit transition schedules its final step via requestAnimationFrame;
    // fake it alongside setTimeout so advancing timers actually flushes onExited.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    renderWithProvider();

    act(() => screen.getByText('show-1').click());
    act(() => screen.getByText('show-2').click());
    expect(screen.getByText('First toast')).toBeInTheDocument();

    // 5s auto-hide + generous buffer for the exit transition.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });

    expect(screen.queryByText('First toast')).not.toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });
});
