import { notFound } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolSettings } from '@/server/services/settings';
import { getRegister, type Register } from '@/server/attendance/attendance-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { registerQuery } from '@/lib/validators/attendance';
import { formatInSchoolTz } from '@/lib/dates';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { RegisterForm } from '../../RegisterForm';

export const dynamic = 'force-dynamic';

/** Daily homeroom register — /attendance/take/section/<sectionId>?date= (FR-15, FR-16). */
export default async function SectionRegisterPage({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { date?: string };
}) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  const { timezone } = await getSchoolSettings();
  const key = registerQuery.safeParse({ sectionId: params.sectionId, date: searchParams.date ?? schoolToday(new Date(), timezone) });
  if (!key.success) notFound();

  let register: Register | null = null;
  let error: string | null = null;
  try {
    register = await getRegister(user, key.data);
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }

  return (
    <Box>
      <PageHeader
        title={register ? `Daily register – ${register.header.sectionName}` : 'Daily register'}
        description={formatInSchoolTz(new Date(`${key.data.date}T12:00:00Z`), 'EEEE d MMM yyyy', 'UTC')}
        breadcrumbs={[{ label: 'Take attendance', href: `/attendance/take?date=${key.data.date}` }, { label: 'Daily register' }]}
      />
      {error && <Alert severity="warning">{error}</Alert>}
      {register && <RegisterForm key={`${key.data.date}-${register.sessionId}`} initial={register} />}
    </Box>
  );
}
