import { describe, expect, it } from 'vitest';
import { embedUrl, parseVideoUrl } from '@/lib/video';

describe('parseVideoUrl (FR-30)', () => {
  it('parses youtube watch and short links', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=5')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x')?.id).toBe('dQw4w9WgXcQ');
  });

  it('parses vimeo', () => {
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' });
  });

  it('rejects everything else', () => {
    for (const bad of [
      'not a url',
      'javascript:alert(1)',
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=<script>',
      'https://vimeo.com/channels/staff',
      'ftp://youtu.be/dQw4w9WgXcQ',
    ]) {
      expect(parseVideoUrl(bad)).toBeNull();
    }
  });
});

describe('embedUrl', () => {
  it('uses privacy-enhanced origins only', () => {
    expect(embedUrl({ provider: 'youtube', id: 'abc123' })).toBe('https://www.youtube-nocookie.com/embed/abc123');
    expect(embedUrl({ provider: 'vimeo', id: '1' })).toBe('https://player.vimeo.com/video/1');
  });
});
