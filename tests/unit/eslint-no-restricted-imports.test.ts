import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import eslintConfig from '../../.eslintrc.json';

const BANNED_NAMED_IMPORTS = [
  'tailwindcss',
  'lucide-react',
  'next-themes',
  '@tanstack/react-table',
  'recharts',
  'react-select',
  'react-datepicker',
  'sonner',
  'notistack',
  'antd',
  'react-bootstrap',
];

const BANNED_PATTERN_IMPORTS = [
  '@radix-ui/react-dialog',
  '@headlessui/react',
  '@fullcalendar/core',
  '@chakra-ui/react',
];

describe('no-restricted-imports (ADR-5: MUI-only)', () => {
  const eslint = new ESLint({
    useEslintrc: false,
    baseConfig: { ...eslintConfig, extends: [] },
    overrideConfig: { rules: { 'no-restricted-imports': eslintConfig.rules['no-restricted-imports'] } },
  } as unknown as ESLint.Options);

  it.each([...BANNED_NAMED_IMPORTS, ...BANNED_PATTERN_IMPORTS])(
    'flags `import x from "%s"` as an error',
    async (moduleName) => {
      const results = await eslint.lintText(`import x from '${moduleName}';\n`, {
        filePath: 'fixture.ts',
      });
      const messages = results[0].messages;
      expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
    },
  );

  it('does not flag an allowed MUI import', async () => {
    const results = await eslint.lintText("import Button from '@mui/material/Button';\n", {
      filePath: 'fixture.ts',
    });
    expect(results[0].messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});
