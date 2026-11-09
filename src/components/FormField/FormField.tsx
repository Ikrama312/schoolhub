'use client';

import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import FormHelperText from '@mui/material/FormHelperText';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import Autocomplete from '@mui/material/Autocomplete';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';

interface BaseProps<TFieldValues extends FieldValues> {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  label: string;
  helperText?: string;
}

/** Plain text / number / etc. MUI TextField bound via Controller. */
export function TextFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
  ...rest
}: BaseProps<TFieldValues> & Omit<TextFieldProps, 'name' | 'label' | 'error' | 'helperText'>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          {...rest}
          label={label}
          error={Boolean(fieldState.error)}
          helperText={fieldState.error?.message ?? helperText}
          fullWidth
        />
      )}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
  options,
}: BaseProps<TFieldValues> & { options: SelectOption[] }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          select
          label={label}
          error={Boolean(fieldState.error)}
          helperText={fieldState.error?.message ?? helperText}
          fullWidth
        >
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    />
  );
}

export function AutocompleteFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
  options,
}: BaseProps<TFieldValues> & { options: SelectOption[] }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Autocomplete
          options={options}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.value === value.value}
          value={options.find((option) => option.value === field.value) ?? null}
          onChange={(_event, value) => field.onChange(value?.value ?? null)}
          renderInput={(params) => (
            <TextField
              {...params}
              label={label}
              error={Boolean(fieldState.error)}
              helperText={fieldState.error?.message ?? helperText}
            />
          )}
        />
      )}
    />
  );
}

export function CheckboxFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
}: BaseProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControlLabel
          control={<Checkbox checked={Boolean(field.value)} onChange={(e) => field.onChange(e.target.checked)} />}
          label={label}
        />
      )}
    />
  );
}

export function SwitchFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
}: BaseProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControlLabel
          control={<Switch checked={Boolean(field.value)} onChange={(e) => field.onChange(e.target.checked)} />}
          label={label}
        />
      )}
    />
  );
}

export function RadioGroupFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
  options,
}: BaseProps<TFieldValues> & { options: SelectOption[] }) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <FormControl error={Boolean(fieldState.error)}>
          <FormLabel>{label}</FormLabel>
          <RadioGroup {...field} value={field.value ?? ''}>
            {options.map((option) => (
              <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
            ))}
          </RadioGroup>
          <FormHelperText>{fieldState.error?.message ?? helperText}</FormHelperText>
        </FormControl>
      )}
    />
  );
}

export function DatePickerFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
}: BaseProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <DatePicker
          label={label}
          value={field.value ?? null}
          onChange={field.onChange}
          slotProps={{
            textField: {
              error: Boolean(fieldState.error),
              helperText: fieldState.error?.message ?? helperText,
              fullWidth: true,
            },
          }}
        />
      )}
    />
  );
}

export function DateTimePickerFormField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  helperText,
}: BaseProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <DateTimePicker
          label={label}
          value={field.value ?? null}
          onChange={field.onChange}
          slotProps={{
            textField: {
              error: Boolean(fieldState.error),
              helperText: fieldState.error?.message ?? helperText,
              fullWidth: true,
            },
          }}
        />
      )}
    />
  );
}
