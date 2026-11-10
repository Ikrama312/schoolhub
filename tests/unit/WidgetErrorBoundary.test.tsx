import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { WidgetErrorBoundary } from '@/components/Widget/WidgetErrorBoundary';

/** PRD-16 FR-2: a throwing widget shows the fallback; Retry resets and refreshes. */
let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error('boom');
  return <p>Widget content</p>;
}

describe('WidgetErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    refresh.mockReset();
    shouldThrow = true;
  });

  it('renders the fallback Alert when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <WidgetErrorBoundary>
        <Flaky />
      </WidgetErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This widget could not load');
    expect(screen.queryByText('Widget content')).not.toBeInTheDocument();
  });

  it('Retry resets the boundary and calls router.refresh()', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <WidgetErrorBoundary>
        <Flaky />
      </WidgetErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Widget content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    shouldThrow = false;
    render(
      <WidgetErrorBoundary>
        <Flaky />
      </WidgetErrorBoundary>,
    );
    expect(screen.getByText('Widget content')).toBeInTheDocument();
  });
});
