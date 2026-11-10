import Link from 'next/link';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { requirePageRole } from '@/server/auth/requireRole';
import { list } from '@/server/consent-forms/consent-forms-service';
import { getSelectedChild } from '@/server/parent/selected-child';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';

const PAGE = { page: 1, pageSize: 100, skip: 0, take: 100 };
const day = (iso: string) => new Date(iso).toLocaleDateString();

/** /consent-forms — PARENT: the selected child's forms; TEACHER: own; ADMIN: all (FR-5, FR-36, FR-37). */
export default async function ConsentFormsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const user = await requirePageRole('ADMIN', 'TEACHER', 'PARENT');

  if (user.role === 'PARENT') {
    const child = await getSelectedChild(user, searchParams);
    // ponytail: first 100 forms for the child; families see few forms.
    const { rows } = child ? await list(user, { studentId: child.studentId, pending: false, sort: { field: 'dueAt', dir: 'asc' } }, PAGE) : { rows: [] };
    const now = Date.now();
    return (
      <>
        <PageHeader title="Consent forms" description={child ? `Forms for ${child.firstName}.` : undefined} />
        {rows.length === 0 ? (
          <EmptyState title="No consent forms" description="Forms from the school that need your signature appear here." />
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table aria-label="Consent forms">
              <TableHead>
                <TableRow>
                  <TableCell>Form</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((f) => {
                  const response = 'children' in f ? f.children[0]?.response : null;
                  const open = Date.parse(f.dueAt) > now;
                  return (
                    <TableRow key={f.id}>
                      <TableCell>{f.title}</TableCell>
                      <TableCell>{day(f.dueAt)}</TableCell>
                      <TableCell>
                        {response ? (
                          <Chip size="small" color={response.value === 'GRANTED' ? 'success' : 'default'} label={response.value === 'GRANTED' ? 'Granted' : 'Declined'} />
                        ) : (
                          <Chip size="small" color={open ? 'warning' : 'default'} label={open ? 'Pending' : 'Not answered'} />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" component={Link} href={`/consent-forms/${f.id}`}>
                          {response || !open ? 'View' : 'Respond'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </>
    );
  }

  const { rows } = await list(user, { pending: false, sort: { field: 'dueAt', dir: 'desc' } }, PAGE);
  return (
    <>
      <PageHeader
        title="Consent forms"
        description={user.role === 'ADMIN' ? 'All consent forms.' : 'Forms you have sent.'}
        actions={
          <Button variant="contained" component={Link} href="/consent-forms/new">
            New consent form
          </Button>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No consent forms yet" description="Create a form to collect parent consent for a trip or activity." />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label="Consent forms">
            <TableHead>
              <TableRow>
                <TableCell>Form</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Audience</TableCell>
                <TableCell>Granted / Declined / No response</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{f.title}</TableCell>
                  <TableCell>{day(f.dueAt)}</TableCell>
                  <TableCell>{f.audiences.map((a) => a.label).join(', ')}</TableCell>
                  <TableCell>{'counts' in f ? `${f.counts.granted} / ${f.counts.declined} / ${f.counts.noResponse}` : '—'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" component={Link} href={`/consent-forms/${f.id}/tracking`}>
                      Tracking
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
