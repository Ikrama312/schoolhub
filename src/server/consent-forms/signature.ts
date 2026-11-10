/** PRD-15 FR-37: the typed signature must be the signer's full name, ignoring case and surrounding/repeated whitespace. Pure. */
export function signatureMatches(typed: string, fullName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(typed) !== '' && norm(typed) === norm(fullName);
}
