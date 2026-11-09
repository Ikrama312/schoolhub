'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { DataGrid, type GridColDef, type GridSortModel } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import { EmptyState } from '@/components/EmptyState/EmptyState';

const SEARCH_DEBOUNCE_MS = 300;

export interface DataTableProps {
  columns: GridColDef[];
  rows: readonly Record<string, unknown>[];
  total: number;
  loading?: boolean;
  /** Row id field name, defaults to "id" (DataGrid's own default). */
  getRowId?: (row: Record<string, unknown>) => string | number;
}

/**
 * Thin wrapper around MUI X DataGrid: server-side pagination/sorting read
 * from (and written to) URL query params, a debounced search box, and the
 * shared EmptyState for the no-rows overlay. Callers refetch when the URL
 * params change — this component owns no fetch logic of its own.
 */
export function DataTable({ columns, rows, total, loading, getRowId }: DataTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Number(searchParams.get('pageSize')) || 20);
  const sortField = searchParams.get('sort') ?? undefined;
  const sortOrder = (searchParams.get('order') as 'asc' | 'desc' | null) ?? undefined;

  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Debounce search -> URL param, resetting to page 1.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== (searchParams.get('q') ?? '')) {
        updateParams({ q: searchInput || undefined, page: '1' });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const sortModel: GridSortModel = sortField ? [{ field: sortField, sort: sortOrder ?? 'asc' }] : [];

  return (
    <Box>
      <TextField
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        placeholder="Search…"
        size="small"
        sx={{ mb: 2, maxWidth: 320 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
          htmlInput: { 'aria-label': 'Search' },
        }}
      />
      <DataGrid
        autoHeight
        columns={columns}
        rows={rows}
        rowCount={total}
        loading={loading}
        getRowId={getRowId}
        paginationMode="server"
        sortingMode="server"
        paginationModel={{ page: page - 1, pageSize }}
        onPaginationModelChange={(model) =>
          updateParams({ page: String(model.page + 1), pageSize: String(model.pageSize) })
        }
        sortModel={sortModel}
        onSortModelChange={(model) =>
          updateParams({ sort: model[0]?.field, order: model[0]?.sort ?? undefined })
        }
        pageSizeOptions={[10, 20, 50, 100]}
        slots={{
          noRowsOverlay: () => <EmptyState title="No results" description="Nothing matches yet." />,
        }}
        disableRowSelectionOnClick
      />
    </Box>
  );
}
