'use client';

import { useState } from 'react';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import type { GradingScaleDto } from '@/server/gradebook/scales-service';
import { ScaleEditorDialog } from './ScaleEditorDialog';

export function GradingScalesClient({ initial }: { initial: GradingScaleDto[] }) {
  const { showToast } = useToast();
  const [scales, setScales] = useState(initial);
  const [editing, setEditing] = useState<GradingScaleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GradingScaleDto | null>(null);

  const reload = async () => {
    const res = await fetch('/api/grading-scales');
    if (res.ok) setScales((await res.json()).data);
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/grading-scales/${deleting.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setDeleting(null);
    if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not delete the scale.', severity: 'error' });
    showToast({ message: 'Scale deleted', severity: 'success' });
    await reload();
  };

  const columns: GridColDef<GradingScaleDto>[] = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    {
      field: 'isDefault',
      headerName: 'Default',
      width: 120,
      renderCell: ({ row }) => (row.isDefault ? <Chip size="small" color="primary" label="Default" /> : null),
    },
    {
      field: 'bands',
      headerName: 'Bands',
      flex: 2,
      minWidth: 240,
      sortable: false,
      valueGetter: (_v, row) => row.bands.map((b) => `${b.letter} ≥ ${b.minPercent}`).join(' · '),
    },
    {
      field: 'actions',
      headerName: '',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row">
          <Tooltip title="Edit">
            <IconButton aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={row.isDefault ? 'The default scale cannot be deleted' : 'Delete'}>
            <span>
              <IconButton aria-label={`Delete ${row.name}`} disabled={row.isDefault} onClick={() => setDeleting(row)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          New scale
        </Button>
      </Stack>
      <DataGrid autoHeight rows={scales} columns={columns} disableRowSelectionOnClick hideFooter />
      {editing && (
        <ScaleEditorDialog
          scale={editing === 'new' ? null : editing}
          isFirst={scales.length === 0}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete grading scale?"
        description={`"${deleting?.name}" will be removed. Courses using it must be switched first.`}
        destructive
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Stack>
  );
}
