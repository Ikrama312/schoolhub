'use client';

import { Component, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

/**
 * PRD-16 FR-2: one failing widget never breaks the dashboard. Shows an Alert with a
 * Retry that resets the boundary and re-fetches the server components (router.refresh()).
 */
interface BoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={this.retry}>
            Retry
          </Button>
        }
      >
        This widget could not load
      </Alert>
    );
  }
}

export function WidgetErrorBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  return <Boundary onRetry={() => router.refresh()}>{children}</Boundary>;
}
