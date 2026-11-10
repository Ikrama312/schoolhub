import NextLink from 'next/link';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { AccessUser } from '@/server/auth/student-access';
import { getMyCourses } from '@/server/dashboards/student';

/** PRD-16 FR-13: per course, the Grades-tab percent/letter, lesson progress and the next lesson. */
export async function MyCoursesWidget({ user }: { user: AccessUser }) {
  const courses = await getMyCourses(user);
  if (!courses.length) return <EmptyState title="You are not enrolled in any courses" />;
  return (
    <Grid container spacing={2}>
      {courses.map((c) => {
        const pct = c.progress.total ? Math.round((c.progress.completed / c.progress.total) * 100) : 0;
        return (
          <Grid key={c.courseId} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Link component={NextLink} href={`/courses/${c.courseId}`} variant="subtitle1">
                  {c.courseName}
                </Link>
                <Typography variant="body2" color="text.secondary">
                  {c.percent === null ? 'No grade yet' : `${c.percent} %${c.letter ? ` (${c.letter})` : ''}`}
                </Typography>
                <LinearProgress variant="determinate" value={pct} sx={{ my: 1 }} aria-label={`${c.courseName} lessons completed`} />
                <Typography variant="caption" color="text.secondary">
                  {c.progress.completed} of {c.progress.total} lessons completed
                </Typography>
                {c.nextLessonHref && (
                  <Link component={NextLink} href={c.nextLessonHref} variant="body2" sx={{ display: 'block', mt: 1 }}>
                    Continue learning
                  </Link>
                )}
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
