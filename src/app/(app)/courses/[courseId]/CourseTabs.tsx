'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { courseTabs } from '@/config/course-tabs';
import type { Role } from '@/config/navigation';

export function CourseTabs({ courseId, role }: { courseId: string; role: Role }) {
  const pathname = usePathname();
  const tabs = courseTabs.filter((t) => t.roles.includes(role));
  // Longest matching href wins so /courses/x/roster doesn't also match Overview.
  const active = tabs
    .filter((t) => pathname === t.href(courseId) || pathname.startsWith(`${t.href(courseId)}/`))
    .sort((a, b) => b.href(courseId).length - a.href(courseId).length)[0];

  return (
    <Tabs value={active?.key ?? false} variant="scrollable" scrollButtons="auto" sx={{ mb: 3 }} aria-label="Course sections">
      {tabs.map((t) => (
        <Tab key={t.key} value={t.key} label={t.label} component={Link} href={t.href(courseId)} />
      ))}
    </Tabs>
  );
}
