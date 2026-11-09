'use client';

import { useEffect, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import type { Role } from '@/config/navigation';

export interface UserPickerOption {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const SEARCH_DEBOUNCE_MS = 300;

export interface UserPickerProps {
  label: string;
  /** Restrict search to a single role (e.g. "PARENT" when linking a student's family). */
  role?: Role;
  multiple?: boolean;
  value: UserPickerOption[] | UserPickerOption | null;
  onChange: (value: UserPickerOption[] | UserPickerOption | null) => void;
  helperText?: string;
  error?: boolean;
}

/**
 * Reusable directory picker (FR-28) on MUI Autocomplete: async search
 * against GET /api/users/search, optional multi-select, avatar+name+role
 * renderOption. Used for inline parent/student linking in the create/edit
 * Stepper and the student detail page's Family card.
 */
export function UserPicker({ label, role, multiple, value, onChange, helperText, error }: UserPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<UserPickerOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (role) params.set('role', role);
        if (inputValue) params.set('q', inputValue);
        const res = await fetch(`/api/users/search?${params.toString()}`);
        const json = await res.json();
        setOptions(res.ok ? json.data : []);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [inputValue, role]);

  const selectedIds = useMemo(() => {
    if (!value) return new Set<string>();
    return new Set(Array.isArray(value) ? value.map((v) => v.id) : [value.id]);
  }, [value]);

  return (
    <Autocomplete
      multiple={Boolean(multiple)}
      options={options}
      value={value as never}
      onChange={(_event, next) => onChange(next as UserPickerOption[] | UserPickerOption | null)}
      inputValue={inputValue}
      onInputChange={(_event, next) => setInputValue(next)}
      getOptionLabel={(option) => `${option.name} (${option.email})`}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      filterOptions={(opts) => opts.filter((opt) => !selectedIds.has(opt.id) || selectedIds.size === 0)}
      loading={loading}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <UserAvatar userId={option.id} name={option.name} size={28} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {option.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {option.email} · {option.role}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          error={error}
          helperText={helperText}
          slotProps={{
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
