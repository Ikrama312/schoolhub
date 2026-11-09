'use client';

import { usePathname, useRouter } from 'next/navigation';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { StudentGradesView } from '@/components/gradebook/StudentGradesView';
import type { StudentGrades } from '@/server/gradebook/student-grades-service';

/** FR-27: parent child selector (empty for students) above the shared grades view. */
export function GradesClient({ initial, linkedChildren: children, courseId }: { initial: StudentGrades; linkedChildren: { id: string; name: string }[]; courseId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Stack spacing={2}>
      {children.length > 1 && (
        <TextField select size="small" label="Child" value={initial.student.id} onChange={(e) => router.push(`${pathname}?studentId=${e.target.value}`)} sx={{ maxWidth: 280 }}>
          {children.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <StudentGradesView initial={initial} courseId={courseId} />
    </Stack>
  );
}
