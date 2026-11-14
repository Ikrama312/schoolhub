'use client';

import Button from '@mui/material/Button';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';

/** PRD-17 FR-33/FR-34 (ADR-9): the browser print dialog covers "Save as PDF". Hidden when printing. */
export function PrintButton() {
  return (
    <Button
      variant="contained"
      startIcon={<PrintOutlinedIcon />}
      onClick={() => window.print()}
      sx={{ '@media print': { display: 'none' } }}
    >
      Print / Save as PDF
    </Button>
  );
}
