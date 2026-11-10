import { Suspense, type ReactNode } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';

/**
 * PRD-16 FR-2: dashboard widget shell. Card + title, error boundary, and Suspense so each
 * widget streams on its own. The async child renders <UpdatedAgo> when its data is cached.
 */
export function Widget({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader title={title} action={action} slotProps={{ title: { variant: 'h6', component: 'h2' } }} />
      <CardContent sx={{ pt: 0 }}>
        <WidgetErrorBoundary>
          <Suspense fallback={<LoadingSkeleton variant="card" />}>{children}</Suspense>
        </WidgetErrorBoundary>
      </CardContent>
    </Card>
  );
}

/** FR-24: "Updated N min ago" from a cached payload's computedAt. */
export function UpdatedAgo({ computedAt }: { computedAt: string }) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(computedAt)) / 60_000));
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
      {minutes === 0 ? 'Updated just now' : `Updated ${minutes} min ago`}
    </Typography>
  );
}
