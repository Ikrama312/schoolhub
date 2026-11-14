'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { formatMoney, sumMoney } from '@/lib/money';

export interface EditorLine {
  description: string;
  amount: string;
  feeItemId?: string | null;
}

export interface FeeItemOption {
  id: string;
  name: string;
  defaultAmount: string;
}

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v);

/**
 * PRD-17 FR-7/FR-20/FR-23: editable charge lines with a live Decimal total (ADR-2). With feeItems, each
 * line picks a fee item (description and default amount pre-fill); without, lines are free text.
 */
export function InvoiceLinesEditor({
  value,
  onChange,
  currency,
  feeItems,
  disabled,
  requireItem = false,
}: {
  value: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  currency: string;
  feeItems?: FeeItemOption[];
  disabled?: boolean;
  /** Fee plans: every line must be a fee item, so the description field is hidden. */
  requireItem?: boolean;
}) {
  const set = (i: number, patch: Partial<EditorLine>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = sumMoney(value.filter((l) => isMoney(l.amount)).map((l) => l.amount));

  return (
    <Stack spacing={1.5}>
      {value.map((line, i) => (
        <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          {feeItems && (
            <Autocomplete
              sx={{ minWidth: 220, flex: 1 }}
              size="small"
              disabled={disabled}
              options={feeItems}
              getOptionLabel={(o) => o.name}
              value={feeItems.find((f) => f.id === line.feeItemId) ?? null}
              onChange={(_e, item) =>
                set(i, item ? { feeItemId: item.id, description: item.name, amount: line.amount || item.defaultAmount } : { feeItemId: null })
              }
              renderInput={(params) => <TextField {...params} label="Fee item" required={requireItem} />}
            />
          )}
          {!requireItem && (
            <TextField
              size="small"
              label="Description"
              sx={{ flex: 2 }}
              disabled={disabled}
              value={line.description}
              onChange={(e) => set(i, { description: e.target.value })}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          )}
          <TextField
            size="small"
            label="Amount"
            sx={{ width: 140 }}
            disabled={disabled}
            value={line.amount}
            error={line.amount !== '' && !isMoney(line.amount)}
            helperText={line.amount !== '' && !isMoney(line.amount) ? 'Up to 2 decimals' : undefined}
            onChange={(e) => set(i, { amount: e.target.value.trim() })}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <IconButton aria-label={`Remove line ${i + 1}`} disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled || value.length >= 50}
          onClick={() => onChange([...value, { description: '', amount: '', feeItemId: null }])}
        >
          Add line
        </Button>
        <Typography variant="subtitle1" aria-live="polite">
          Total: {formatMoney(total, currency)}
        </Typography>
      </Stack>
    </Stack>
  );
}
