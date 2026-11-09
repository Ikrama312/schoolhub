/**
 * Pure upload validation (PRD-08 FR-4..FR-7, FR-40, FR-41, ADR-3). No I/O:
 * the caller sniffs the first bytes with file-type and passes the result in.
 */

type Sniff = 'required' | 'none' | 'zip-or-ooxml';

interface Rule {
  /** Stored mimeType -- never taken from the client. */
  mime: string;
  sniff: Sniff;
  /** Sniffed mimes accepted for 'required'/'zip-or-ooxml'. */
  accept: string[];
}

const CFB = 'application/x-cfb';
const OOXML = (mime: string): Rule => ({ mime, sniff: 'zip-or-ooxml', accept: ['application/zip', mime] });

export const ALLOWED: Record<string, Rule> = {
  pdf: { mime: 'application/pdf', sniff: 'required', accept: ['application/pdf'] },
  doc: { mime: 'application/msword', sniff: 'required', accept: [CFB] },
  xls: { mime: 'application/vnd.ms-excel', sniff: 'required', accept: [CFB] },
  ppt: { mime: 'application/vnd.ms-powerpoint', sniff: 'required', accept: [CFB] },
  docx: OOXML('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  xlsx: OOXML('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  pptx: OOXML('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  txt: { mime: 'text/plain', sniff: 'none', accept: [] },
  csv: { mime: 'text/csv', sniff: 'none', accept: [] },
  png: { mime: 'image/png', sniff: 'required', accept: ['image/png'] },
  jpg: { mime: 'image/jpeg', sniff: 'required', accept: ['image/jpeg'] },
  jpeg: { mime: 'image/jpeg', sniff: 'required', accept: ['image/jpeg'] },
  gif: { mime: 'image/gif', sniff: 'required', accept: ['image/gif'] },
  webp: { mime: 'image/webp', sniff: 'required', accept: ['image/webp'] },
  mp3: { mime: 'audio/mpeg', sniff: 'required', accept: ['audio/mpeg'] },
  mp4: { mime: 'video/mp4', sniff: 'required', accept: ['video/mp4', 'audio/mp4'] },
  zip: { mime: 'application/zip', sniff: 'required', accept: ['application/zip'] },
  // FR-41: SVG is text (no signature) and only allowed for the logo context.
  svg: { mime: 'image/svg+xml', sniff: 'none', accept: [] },
};

const LOGO_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
const NAME_MAX = 150;

/** Lower-case extension without the dot, or '' when there is none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** FR-7: strip path separators and control chars, trim, cap at 150 chars keeping the extension. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  let clean = name.replace(/[/\\\x00-\x1f\x7f]/g, '').trim();
  if (!clean) clean = 'file';
  if (clean.length <= NAME_MAX) return clean;
  const ext = extOf(clean);
  const suffix = ext && ext.length < 20 ? `.${ext}` : '';
  return clean.slice(0, NAME_MAX - suffix.length) + suffix;
}

export type TypeCheck = { ok: true; mime: string } | { ok: false; error: string };

/**
 * ext: from the sanitised name. sniffed: file-type's mime for the head, or
 * undefined when no signature matched. head: the first bytes (SVG check).
 */
export function checkType(ext: string, sniffed: string | undefined, context: string, head?: Buffer): TypeCheck {
  const error = { ok: false as const, error: `File type .${ext || 'unknown'} is not allowed.` };
  const rule = ALLOWED[ext];
  if (!rule) return error;
  if (context === 'logo' ? !LOGO_EXTS.includes(ext) : ext === 'svg') return error;

  switch (rule.sniff) {
    case 'none':
      // Any detected signature (ELF, PE, zip...) behind a text extension is a disguise.
      if (sniffed !== undefined) return error;
      if (ext === 'svg' && !(head ?? Buffer.alloc(0)).toString('utf8').toLowerCase().includes('<svg')) return error;
      return { ok: true, mime: rule.mime };
    case 'required':
    case 'zip-or-ooxml':
      return sniffed !== undefined && rule.accept.includes(sniffed) ? { ok: true, mime: rule.mime } : error;
  }
}

/** Per-context byte limit: 2 MB for logos, MAX_UPLOAD_MB otherwise. */
export function maxBytesFor(context: string, maxUploadMb: number): number {
  return (context === 'logo' ? 2 : maxUploadMb) * 1024 * 1024;
}
