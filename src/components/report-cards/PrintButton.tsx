'use client';

import Button from '@mui/material/Button';
import PrintIcon from '@mui/icons-material/Print';

/** FR-35: "Print / Save as PDF" — the browser's print dialog handles PDF export. */
export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()} data-print-hide>
      {label}
    </Button>
  );
}
