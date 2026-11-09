import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';

export interface LoadingSkeletonProps {
  variant: 'table' | 'card' | 'form';
  rows?: number;
}

export function LoadingSkeleton({ variant, rows = 5 }: LoadingSkeletonProps) {
  if (variant === 'table') {
    return (
      <Stack spacing={1}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} variant="rectangular" height={40} />
        ))}
      </Stack>
    );
  }

  if (variant === 'card') {
    return <Skeleton variant="rounded" height={140} />;
  }

  return (
    <Stack spacing={2}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} variant="rounded" height={56} />
      ))}
    </Stack>
  );
}
