import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  icon?: React.ReactNode;
}

const DELTA_COLOR: Record<'up' | 'down' | 'flat', 'success' | 'error' | 'default'> = {
  up: 'success',
  down: 'error',
  flat: 'default',
};

export function StatCard({ label, value, delta, icon }: StatCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              {value}
            </Typography>
            {delta && <Chip size="small" label={delta.value} color={DELTA_COLOR[delta.direction]} />}
          </Stack>
          {icon && <Box sx={{ color: 'primary.main' }}>{icon}</Box>}
        </Stack>
      </CardContent>
    </Card>
  );
}
