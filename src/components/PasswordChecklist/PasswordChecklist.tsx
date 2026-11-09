'use client';

import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { PASSWORD_RULES, passwordChecks, type PasswordCheckResult } from '@/lib/validators/auth';

export interface PasswordChecklistProps {
  password: string;
  email: string;
}

/** Live password-rule checklist (FR-17). The common-password rule is server-only. */
export function PasswordChecklist({ password, email }: PasswordChecklistProps) {
  const checks = passwordChecks(password, email);
  return (
    <List dense disablePadding aria-label="Password requirements">
      {(Object.keys(PASSWORD_RULES) as (keyof PasswordCheckResult)[]).map((key) => {
        const met = checks[key];
        return (
          <ListItem key={key} disableGutters>
            <ListItemIcon sx={{ minWidth: 32 }}>
              {met ? (
                <CheckCircleIcon fontSize="small" color="success" titleAccess="Met" />
              ) : (
                <RadioButtonUncheckedIcon fontSize="small" color="disabled" titleAccess="Not met" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={PASSWORD_RULES[key].label}
              slotProps={{ primary: { variant: 'body2', color: met ? 'text.primary' : 'text.secondary' } }}
            />
          </ListItem>
        );
      })}
    </List>
  );
}
