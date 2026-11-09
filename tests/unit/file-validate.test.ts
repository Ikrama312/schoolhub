import { describe, expect, it } from 'vitest';
import { checkType, extOf, maxBytesFor, sanitizeFilename } from '@/server/files/validate';

describe('sanitizeFilename (FR-7)', () => {
  it('strips path separators and control characters', () => {
    expect(sanitizeFilename('../../etc/pass\x00wd.txt')).toBe('....etcpasswd.txt');
    expect(sanitizeFilename('a\\b\x1f\x7fc.pdf')).toBe('abc.pdf');
  });

  it('trims and falls back when empty', () => {
    expect(sanitizeFilename('  notes.txt  ')).toBe('notes.txt');
    expect(sanitizeFilename('///')).toBe('file');
  });

  it('caps at 150 characters and keeps the extension', () => {
    const out = sanitizeFilename(`${'x'.repeat(300)}.pdf`);
    expect(out).toHaveLength(150);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('extOf lower-cases and ignores dotfiles', () => {
    expect(extOf('Report.PDF')).toBe('pdf');
    expect(extOf('.bashrc')).toBe('');
  });
});

describe('checkType (FR-5, FR-6, FR-41)', () => {
  it('accepts a real pdf and stores the table mime', () => {
    expect(checkType('pdf', 'application/pdf', 'lesson')).toEqual({ ok: true, mime: 'application/pdf' });
  });

  it('rejects an exe renamed to .pdf', () => {
    expect(checkType('pdf', 'application/x-msdownload', 'lesson')).toEqual({
      ok: false,
      error: 'File type .pdf is not allowed.',
    });
  });

  it('rejects an ELF renamed to .csv, accepts plain csv/txt', () => {
    expect(checkType('csv', 'application/x-elf', 'lesson').ok).toBe(false);
    expect(checkType('csv', undefined, 'lesson')).toEqual({ ok: true, mime: 'text/csv' });
    expect(checkType('txt', undefined, 'lesson').ok).toBe(true);
  });

  it('accepts docx sniffed as zip or as OOXML', () => {
    expect(checkType('docx', 'application/zip', 'lesson').ok).toBe(true);
    expect(
      checkType('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'lesson').ok,
    ).toBe(true);
    expect(checkType('docx', undefined, 'lesson').ok).toBe(false);
  });

  it('accepts legacy office as CFB', () => {
    expect(checkType('doc', 'application/x-cfb', 'lesson')).toEqual({ ok: true, mime: 'application/msword' });
  });

  it('rejects unknown extensions with the FR-5 message', () => {
    expect(checkType('exe', undefined, 'lesson')).toEqual({ ok: false, error: 'File type .exe is not allowed.' });
  });

  it('allows svg only for logo and only when it looks like svg', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(checkType('svg', undefined, 'lesson', svg).ok).toBe(false);
    expect(checkType('svg', undefined, 'logo', svg)).toEqual({ ok: true, mime: 'image/svg+xml' });
    expect(checkType('svg', undefined, 'logo', Buffer.from('hello')).ok).toBe(false);
  });

  it('limits logo to image types', () => {
    expect(checkType('pdf', 'application/pdf', 'logo').ok).toBe(false);
    expect(checkType('png', 'image/png', 'logo').ok).toBe(true);
  });
});

describe('maxBytesFor (FR-4, FR-40)', () => {
  it('is 2 MB for logo and MAX_UPLOAD_MB otherwise', () => {
    expect(maxBytesFor('logo', 25)).toBe(2 * 1024 * 1024);
    expect(maxBytesFor('lesson', 25)).toBe(25 * 1024 * 1024);
  });
});
