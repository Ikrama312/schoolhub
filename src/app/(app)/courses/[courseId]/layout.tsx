import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { assertCanViewCourse } from '@/server/auth/course-access';
import { AppError } from '@/server/http';
import { getCourse } from '@/server/courses/courses-service';
import { ALL_ROLES } from '@/config/navigation';
import { CourseTabs } from './CourseTabs';

export const dynamic = 'force-dynamic';

/** Course home shell — PRD-05 FR-16/FR-18. Gate once here; tabs inherit it. */
export default async function CourseLayout({
  params,
  children,
}: {
  params: { courseId: string };
  children: React.ReactNode;
}) {
  const user = await requirePageRole(...ALL_ROLES);
  try {
    await assertCanViewCourse(user, params.courseId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const course = await getCourse(params.courseId);
  const teachers = [course.teacher, ...course.coTeachers].map((t) => t.name).join(', ');

  return (
    <Box>
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ height: 8, bgcolor: course.subject.color }} />
        <Box sx={{ p: 2 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
            {course.name}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 0.5, flexWrap: 'wrap', color: 'text.secondary' }} useFlexGap>
            <Typography variant="body2">{course.code}</Typography>
            <Typography variant="body2">Teachers: {teachers}</Typography>
            {course.section && <Typography variant="body2">Section {course.section.name}</Typography>}
            {course.section?.room && <Typography variant="body2">Room {course.section.room.name}</Typography>}
          </Stack>
        </Box>
      </Paper>
      <CourseTabs courseId={course.id} role={user.role} />
      {children}
    </Box>
  );
}
