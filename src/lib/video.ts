/**
 * Video URL parsing (PRD-08 FR-30). Shared by the Zod validator and the
 * viewer. Only ever emits the two privacy-enhanced origins allowed by the
 * CSP frame-src in next.config.js.
 */
export interface ParsedVideo {
  provider: 'youtube' | 'vimeo';
  id: string;
}

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d{1,12}$/;

export function parseVideoUrl(raw: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const firstSegment = url.pathname.split('/').filter(Boolean)[0] ?? '';

  if (host === 'youtube.com' && url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return YT_ID.test(id) ? { provider: 'youtube', id } : null;
  }
  if (host === 'youtu.be') {
    return YT_ID.test(firstSegment) ? { provider: 'youtube', id: firstSegment } : null;
  }
  if (host === 'vimeo.com') {
    return VIMEO_ID.test(firstSegment) ? { provider: 'vimeo', id: firstSegment } : null;
  }
  return null;
}

export function embedUrl(video: ParsedVideo): string {
  return video.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${video.id}`
    : `https://player.vimeo.com/video/${video.id}`;
}
