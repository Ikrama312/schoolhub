import { describe, expect, it } from 'vitest';
import { signatureMatches } from '@/server/consent-forms/signature';

/** FR-46: signature match ignores case and whitespace. */
describe('signatureMatches', () => {
  it('matches case-insensitively with surrounding whitespace', () => {
    expect(signatureMatches('  pat parent ', 'Pat Parent')).toBe(true);
    expect(signatureMatches('PAT PARENT', 'Pat Parent')).toBe(true);
    expect(signatureMatches('Pat  Parent', 'Pat Parent')).toBe(true);
  });
  it('rejects other names and blanks', () => {
    expect(signatureMatches('Pat Parents', 'Pat Parent')).toBe(false);
    expect(signatureMatches('Pat', 'Pat Parent')).toBe(false);
    expect(signatureMatches('   ', '')).toBe(false);
  });
});
