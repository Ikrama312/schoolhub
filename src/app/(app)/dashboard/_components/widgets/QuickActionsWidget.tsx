import NextLink from 'next/link';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import AssignmentIcon from '@mui/icons-material/AssignmentOutlined';
import ChecklistIcon from '@mui/icons-material/ChecklistOutlined';
import QuizIcon from '@mui/icons-material/QuizOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import { prisma } from '@/server/db';
import type { AccessUser } from '@/server/auth/student-access';
import { ANNOUNCEMENTS_AVAILABLE } from '@/server/dashboards/announcements';

/** PRD-16 FR-9: static shortcuts. With one course they go straight to the form; otherwise to My courses. */
export async function QuickActionsWidget({ user }: { user: AccessUser }) {
  const courses = await prisma.course.findMany({
    where: { archivedAt: null, academicYear: { isCurrent: true }, OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] },
    select: { id: true },
    take: 2,
  });
  const only = courses.length === 1 ? courses[0].id : null;
  const actions = [
    { label: 'New assignment', href: only ? `/courses/${only}/assignments/new` : '/my-courses', icon: <AssignmentIcon /> },
    { label: 'Take attendance', href: '/attendance/take', icon: <ChecklistIcon /> },
    { label: 'New quiz', href: only ? `/courses/${only}/quizzes/new` : '/my-courses', icon: <QuizIcon /> },
    // Hidden until PRD-12 provides the announcements route.
    ...(ANNOUNCEMENTS_AVAILABLE ? [{ label: 'New announcement', href: '/announcements/new', icon: <CampaignIcon /> }] : []),
  ];
  return (
    <Stack spacing={1}>
      {actions.map((a) => (
        <Button key={a.label} component={NextLink} href={a.href} variant="outlined" startIcon={a.icon} sx={{ justifyContent: 'flex-start' }}>
          {a.label}
        </Button>
      ))}
    </Stack>
  );
}
