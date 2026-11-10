import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { listLinkedChildren } from '@/server/parent/selected-child';
import { getChildrenSummary } from '@/server/parent/overview-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';

/** /my-children — one child → that child's overview; otherwise a summary card per child (FR-7, FR-8). */
export default async function MyChildrenPage() {
  const user = await requirePageRole('PARENT');
  const children = await listLinkedChildren(user.id);
  if (children.length === 1) redirect(`/my-children/${children[0].studentId}`);
  if (children.length === 0) {
    return (
      <>
        <PageHeader title="My children" />
        <EmptyState title="No children linked yet" description="Ask the school office to link your account to your child." />
      </>
    );
  }
  const summaries = await getChildrenSummary(user);
  return (
    <>
      <PageHeader title="My children" />
      <Grid container spacing={2}>
        {summaries.map((s) => (
          <Grid key={s.student.id} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined">
              <CardActionArea component={Link} href={`/my-children/${s.student.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
                    <UserAvatar userId={s.student.id} name={`${s.student.firstName} ${s.student.lastName}`} size={48} />
                    <div>
                      <Typography variant="h6">
                        {s.student.firstName} {s.student.lastName}
                      </Typography>
                      {s.student.sectionName && (
                        <Typography variant="body2" color="text.secondary">
                          {s.student.sectionName}
                        </Typography>
                      )}
                    </div>
                  </Stack>
                  <Stack direction="row" spacing={3}>
                    <Stat label="Attendance (term)" value={s.attendanceRateTerm === null ? '—' : `${Math.round(s.attendanceRateTerm * 1000) / 10}%`} />
                    <Stat label="Missing work" value={String(s.missingAssignments)} danger={s.missingAssignments > 0} />
                    <Stat label="Average grade" value={s.averageGradePct === null ? '—' : `${s.averageGradePct}%`} />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <Typography variant="h6" color={danger ? 'error' : undefined}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </div>
  );
}
