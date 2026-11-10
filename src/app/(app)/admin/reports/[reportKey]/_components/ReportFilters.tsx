'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { format as formatDate } from 'date-fns';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

type Option = { id: string; name: string };
export type FilterField = 'dateRange' | 'gradeLevel' | 'sectionId' | 'subjectId' | { key: 'groupBy'; options: Option[] };

const toLocal = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

/** PRD-16 FR-33: year/term selector + report filters, all in the URL (the server page re-runs the report). */
export function ReportFilters(props: {
  fields: FilterField[];
  years: (Option & { terms: Option[] })[];
  selected: { academicYearId: string; termId: string | null; from: string; to: string };
  gradeLevels: Option[];
  sections: Option[];
  subjects: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  const select = (key: string, label: string, options: Option[], value: string, onChange: (v: string) => void, allowAll = true) => (
    <FormControl key={key} size="small" sx={{ minWidth: 160 }}>
      <InputLabel id={`rf-${key}`}>{label}</InputLabel>
      <Select labelId={`rf-${key}`} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <MenuItem value="">All</MenuItem>}
        {options.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            {o.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const year = props.years.find((y) => y.id === props.selected.academicYearId);
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', rowGap: 2 }}>
      {select('academicYearId', 'Academic year', props.years, props.selected.academicYearId, (v) => set({ academicYearId: v, termId: null, from: null, to: null }), false)}
      {select('termId', 'Term', year?.terms ?? [], props.selected.termId ?? '', (v) => set({ termId: v || null, from: null, to: null }), false)}
      {props.fields.map((f) => {
        if (f === 'dateRange') {
          return (
            <Stack key="range" direction="row" spacing={2}>
              <DatePicker
                label="From"
                value={toLocal(props.selected.from)}
                maxDate={toLocal(props.selected.to)}
                onChange={(d) => d && !Number.isNaN(d.getTime()) && set({ from: formatDate(d, 'yyyy-MM-dd') })}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="To"
                value={toLocal(props.selected.to)}
                minDate={toLocal(props.selected.from)}
                onChange={(d) => d && !Number.isNaN(d.getTime()) && set({ to: formatDate(d, 'yyyy-MM-dd') })}
                slotProps={{ textField: { size: 'small' } }}
              />
            </Stack>
          );
        }
        if (f === 'gradeLevel') return select('gradeLevel', 'Grade level', props.gradeLevels, params.get('gradeLevel') ?? '', (v) => set({ gradeLevel: v }));
        if (f === 'sectionId') return select('sectionId', 'Section', props.sections, params.get('sectionId') ?? '', (v) => set({ sectionId: v }));
        if (f === 'subjectId') return select('subjectId', 'Subject', props.subjects, params.get('subjectId') ?? '', (v) => set({ subjectId: v }));
        return select('groupBy', 'Group by', f.options, params.get('groupBy') ?? f.options[0].id, (v) => set({ groupBy: v }), false);
      })}
    </Stack>
  );
}
