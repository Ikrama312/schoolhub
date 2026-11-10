import { Roboto } from 'next/font/google';
import { createTheme } from '@mui/material/styles';
// PRD-14 FR-9: adds the scheduler's component keys to the theme types.
import type {} from '@mui/x-scheduler/theme-augmentation';

export const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

/**
 * cssVariables + light/dark colorSchemes is what lets the root layout render
 * the correct mode server-side (no client flash) — see FR-18/NFR-2.
 */
export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#4F46E5' },
        secondary: { main: '#0EA5E9' },
        error: { main: '#B91C1C' },
        warning: { main: '#B45309' },
        success: { main: '#15803D' },
        info: { main: '#0369A1' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#818CF8' },
        secondary: { main: '#38BDF8' },
        error: { main: '#F87171' },
        warning: { main: '#FBBF24' },
        success: { main: '#4ADE80' },
        info: { main: '#38BDF8' },
      },
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: roboto.style.fontFamily,
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
  },
});
