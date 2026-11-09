import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridColDef } from '@mui/x-data-grid';
import { DataTable } from '@/components/DataTable/DataTable';

// MUI X DataGrid measures its container via ResizeObserver, which jsdom
// doesn't implement — stub it so the grid can mount under Vitest/jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).ResizeObserver = ResizeObserverStub;

const push = vi.fn();
let search = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/students',
  useSearchParams: () => new URLSearchParams(search),
}));

const columns: GridColDef[] = [{ field: 'name', headerName: 'Name', sortable: true }];
const rows = [{ id: '1', name: 'Ada Lovelace' }];

beforeEach(() => {
  push.mockClear();
  search = '';
});

describe('DataTable', () => {
  it('renders the given rows', () => {
    render(<DataTable columns={columns} rows={rows} total={1} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} total={0} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('debounces the search box into a `q` URL param and resets to page 1', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} total={1} />);

    await user.type(screen.getByLabelText('Search'), 'ada');

    await waitFor(() => expect(push).toHaveBeenCalled(), { timeout: 1000 });
    const lastCall = push.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('q=ada');
    expect(lastCall).toContain('page=1');
  });

  it('reads the initial search value from the `q` URL param', () => {
    search = 'q=existing';
    render(<DataTable columns={columns} rows={rows} total={1} />);
    expect(screen.getByLabelText('Search')).toHaveValue('existing');
  });
});
