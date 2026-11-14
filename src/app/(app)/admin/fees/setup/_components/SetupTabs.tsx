'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { listDiscounts, listFeeItems, listPlans } from '@/server/fees/fees-service';
import { FeeItemsTab } from './FeeItemsTab';
import { FeePlansTab } from './FeePlansTab';
import { DiscountsTab } from './DiscountsTab';
import { OptionalFeesTab } from './OptionalFeesTab';
import { StudentDiscountsTab } from './StudentDiscountsTab';

type Option = { id: string; name: string };
export interface SetupData {
  canWrite: boolean;
  currency: string;
  academicYear: Option | null;
  terms: Option[];
  grades: Option[];
  sections: Option[];
  items: Awaited<ReturnType<typeof listFeeItems>>['items'];
  plans: Awaited<ReturnType<typeof listPlans>>['plans'];
  discounts: Awaited<ReturnType<typeof listDiscounts>>['discounts'];
}

const TABS = [
  { key: 'items', label: 'Fee items' },
  { key: 'plans', label: 'Fee plans' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'optional', label: 'Optional fees' },
  { key: 'student-discounts', label: 'Student discounts' },
] as const;

/** POST/PUT/PATCH JSON to a fee route; throws the server's message. */
export async function sendJson<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = json?.error?.details?.fieldErrors as Record<string, string[]> | undefined;
    const first = fields && Object.values(fields).flat()[0];
    throw new Error(first ?? json?.error?.message ?? 'Request failed.');
  }
  return json.data as T;
}

/** PRD-17 FR-6 to FR-10: setup tabs; the tab is kept in ?tab= so a refresh stays put. */
export function SetupTabs({ data }: { data: SetupData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = TABS.findIndex((t) => t.key === searchParams.get('tab'));
  const [tab, setTab] = useState(Math.max(0, initial));

  const panels = [
    <FeeItemsTab key="items" data={data} />,
    <FeePlansTab key="plans" data={data} />,
    <DiscountsTab key="discounts" data={data} />,
    <OptionalFeesTab key="optional" data={data} />,
    <StudentDiscountsTab key="student-discounts" data={data} />,
  ];

  return (
    <Box>
      {!data.canWrite && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can view fee setup. Only a bursar can make changes.
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(_e, v: number) => {
          setTab(v);
          router.replace(`${pathname}?tab=${TABS[v].key}`, { scroll: false });
        }}
        variant="scrollable"
        aria-label="Fee setup sections"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {TABS.map((t, i) => (
          <Tab key={t.key} label={t.label} id={`fee-tab-${i}`} aria-controls={`fee-tabpanel-${i}`} />
        ))}
      </Tabs>
      <Box role="tabpanel" id={`fee-tabpanel-${tab}`} aria-labelledby={`fee-tab-${tab}`}>
        {panels[tab]}
      </Box>
    </Box>
  );
}
