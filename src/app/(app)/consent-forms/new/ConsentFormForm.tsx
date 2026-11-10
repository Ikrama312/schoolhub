'use client';

import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { useToast } from '@/components/Toast/useToast';
import { CONSENT_DESCRIPTION_MAX, consentFormInputSchema, type ConsentFormValues } from '@/lib/validators/consent-forms';

type Option = { id: string; label: string };
type AudType = 'GRADE_LEVEL' | 'SECTION' | 'COURSE';
export type AudienceOptions = Record<AudType, Option[]>;

const TYPE_LABELS: Record<AudType, string> = { GRADE_LEVEL: 'Grade level', SECTION: 'Section', COURSE: 'Course' };

/** FR-36: title, Markdown description, due date, optional calendar event, audience rows (announcements audience pattern). */
export function ConsentFormForm({ audienceOptions, allowedTypes, events }: { audienceOptions: AudienceOptions; allowedTypes: AudType[]; events: Option[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { control, handleSubmit, setError, setValue, watch, formState } = useForm<ConsentFormValues>({
    resolver: zodResolver(consentFormInputSchema),
    defaultValues: {
      title: '',
      description: '',
      dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      eventId: null,
      audiences: [{ type: allowedTypes[0], refId: '' }],
    },
  });
  const audiences = useFieldArray({ control, name: 'audiences' });
  const rows = watch('audiences');
  const err = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    const res = await fetch('/api/consent-forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      for (const [f, msgs] of Object.entries((json?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>)) setError(f as keyof ConsentFormValues, { message: msgs[0] });
      showToast({ message: json?.error?.message ?? 'Could not create the form.', severity: 'error' });
      return;
    }
    showToast({ message: `Form sent to ${json.data.notifiedParents} parent(s)`, severity: 'success' });
    router.push(`/consent-forms/${json.data.id}/tracking`);
  });

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 760 }}>
      <Stack component="form" spacing={3} onSubmit={onSubmit} noValidate>
        <Controller name="title" control={control} render={({ field }) => <TextField label="Title" {...field} error={!!err.title} helperText={err.title?.message} />} />
        <Controller
          name="description"
          control={control}
          render={({ field }) => <MarkdownEditor label="Description" value={field.value} onChange={field.onChange} maxLength={CONSENT_DESCRIPTION_MAX} error={err.description?.message} />}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Controller
            name="dueAt"
            control={control}
            render={({ field }) => (
              <DateTimePicker
                label="Respond by"
                ampm={false}
                disablePast
                value={field.value ? new Date(field.value) : null}
                onChange={(d) => field.onChange(d && !Number.isNaN(d.getTime()) ? d.toISOString() : '')}
                slotProps={{ textField: { fullWidth: true, error: !!err.dueAt, helperText: err.dueAt?.message } }}
              />
            )}
          />
          <Controller
            name="eventId"
            control={control}
            render={({ field }) => (
              <Autocomplete
                fullWidth
                options={events}
                value={events.find((e) => e.id === field.value) ?? null}
                onChange={(_, v) => field.onChange(v?.id ?? null)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => <TextField {...params} label="Linked calendar event (optional)" />}
              />
            )}
          />
        </Stack>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Who is this for?
          </Typography>
          <Stack spacing={1.5}>
            {audiences.fields.map((row, i) => (
              <Stack key={row.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                <Controller
                  name={`audiences.${i}.type`}
                  control={control}
                  render={({ field }) => (
                    <TextField
                      select
                      size="small"
                      label="Type"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e.target.value);
                        setValue(`audiences.${i}.refId`, '');
                      }}
                      sx={{ minWidth: 160 }}
                      disabled={allowedTypes.length === 1}
                    >
                      {allowedTypes.map((t) => (
                        <MenuItem key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  name={`audiences.${i}.refId`}
                  control={control}
                  render={({ field }) => {
                    const type = (rows[i]?.type ?? allowedTypes[0]) as AudType;
                    const list = audienceOptions[type];
                    return (
                      <Autocomplete
                        size="small"
                        sx={{ flexGrow: 1 }}
                        options={list}
                        value={list.find((o) => o.id === field.value) ?? null}
                        onChange={(_, v) => field.onChange(v?.id ?? '')}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        renderInput={(params) => (
                          <TextField {...params} label={TYPE_LABELS[type]} error={!!err.audiences?.[i]?.refId} helperText={err.audiences?.[i]?.refId?.message} />
                        )}
                      />
                    );
                  }}
                />
                <IconButton aria-label={`Remove audience ${i + 1}`} onClick={() => audiences.remove(i)} disabled={audiences.fields.length === 1}>
                  <DeleteOutlinedIcon />
                </IconButton>
              </Stack>
            ))}
            {err.audiences?.message && <FormHelperText error>{err.audiences.message}</FormHelperText>}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={() => audiences.append({ type: allowedTypes[0], refId: '' })} disabled={audiences.fields.length >= 20}>
                Add audience
              </Button>
            </Box>
          </Stack>
        </Box>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => router.back()} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Sending…' : 'Send to parents'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
