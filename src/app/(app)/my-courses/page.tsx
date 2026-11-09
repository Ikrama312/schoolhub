import Link from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { listMyCourses } from '@/server/courses/courses-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ALL_ROLES } from '@/config/navigation';

export const dynamic = 'force-dynamic';

interface CourseCard {
  id: string;
  name: string;
  code: string;
  subjectColor: string;
  section?: { name: string } | null;
  enrolledCount?: number;
  teacher?: { name: string };
}

function CourseGrid({ courses }: { courses: CourseCard[] }) {
  if (courses.length === 0) return <EmptyState title="No courses yet" description="Courses appear here once you are enrolled or assigned." />;
  return (
    <Grid container spacing={2}>
      {courses.map((c) => (
        <Grid key={c.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <Card variant="outlined" sx={{ height: '100%', borderTop: 4, borderTopColor: c.subjectColor }}>
            <CardActionArea component={Link} href={`/courses/${c.id}`} sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
                  {c.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {c.code}
                  {c.section ? ` · Section ${c.section.name}` : ''}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {c.teacher ? c.teacher.name : `${c.enrolledCount ?? 0} enrolled`}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

/** /my-courses — PRD-05 FR-19. */
export default async function MyCoursesPage() {
  const user = await requirePageRole(...ALL_ROLES);
  const result = await listMyCourses(user);
  const groups = result as { child: { id: string; name: string }; courses: CourseCard[] }[];

  return (
    <Box>
      <PageHeader title="My courses" />
      {user.role === 'PARENT' ? (
        groups.length === 0 ? (
          <EmptyState title="No linked students" />
        ) : (
          groups.map((group) => (
            <Box key={group.child.id} sx={{ mb: 4 }}>
              <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
                {group.child.name}
              </Typography>
              <CourseGrid courses={group.courses} />
            </Box>
          ))
        )
      ) : (
        <CourseGrid courses={result as CourseCard[]} />
      )}
    </Box>
  );
}
