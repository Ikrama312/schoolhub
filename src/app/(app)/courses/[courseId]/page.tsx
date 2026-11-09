import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { getCourse } from '@/server/courses/courses-service';
import { StatCard } from '@/components/StatCard/StatCard';

export const dynamic = 'force-dynamic';

/** Course Overview tab — access already gated by the layout (FR-16). */
export default async function CourseOverviewPage({ params }: { params: { courseId: string } }) {
  const course = await getCourse(params.courseId);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
          <Typography variant="subtitle1" component="h2" gutterBottom sx={{ fontWeight: 600 }}>
            About this course
          </Typography>
          <Typography variant="body2" color={course.description ? 'text.primary' : 'text.secondary'}>
            {course.description ?? 'No description yet.'}
          </Typography>
          <Typography variant="subtitle2" component="h3" sx={{ mt: 2 }}>
            Teachers
          </Typography>
          <Typography variant="body2">
            {course.teacher.name} (lead){course.coTeachers.map((t) => `, ${t.name}`).join('')}
          </Typography>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <StatCard
          label="Enrolled students"
          value={course.capacity ? `${course.enrolledCount}/${course.capacity}` : course.enrolledCount}
        />
      </Grid>
    </Grid>
  );
}
