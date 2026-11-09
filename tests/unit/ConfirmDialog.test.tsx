import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title/description when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete student"
        description="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Delete student')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows a pending spinner and disables buttons while onConfirm resolves', async () => {
    const user = userEvent.setup();
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    render(<ConfirmDialog open title="Delete" destructive onConfirm={onConfirm} onCancel={() => {}} />);

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolveConfirm();
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });
});
