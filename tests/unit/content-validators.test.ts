import { describe, expect, it } from 'vitest';
import { lessonUpdate, moduleCreate, reorderSchema } from '@/lib/validators/content';

// SH-8 QA: FR-16 field limits, FR-28 schedule-in-future, FR-23 reorder shape.
describe('content validators', () => {
  it('enforces title / markdown / minutes limits', () => {
    expect(moduleCreate.safeParse({ title: 'x'.repeat(120) }).success).toBe(true);
    expect(moduleCreate.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
    expect(lessonUpdate.safeParse({ title: 'x'.repeat(151) }).success).toBe(false);
    expect(lessonUpdate.safeParse({ contentMarkdown: 'x'.repeat(100_001) }).success).toBe(false);
    expect(lessonUpdate.safeParse({ estimatedMinutes: 0 }).success).toBe(false);
    expect(lessonUpdate.safeParse({ estimatedMinutes: 600 }).success).toBe(true);
    expect(lessonUpdate.safeParse({ estimatedMinutes: 601 }).success).toBe(false);
  });

  it('allows only http(s) links and YouTube/Vimeo videos', () => {
    const link = (url: string) => lessonUpdate.safeParse({ links: [{ title: 't', url }] }).success;
    expect(link('https://example.com')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('ftp://example.com/x')).toBe(false);
    expect(lessonUpdate.safeParse({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }).success).toBe(true);
    expect(lessonUpdate.safeParse({ videoUrl: 'https://evil.com/watch?v=dQw4w9WgXcQ' }).success).toBe(false);
  });

  it('SCHEDULED requires a future publishAt', () => {
    expect(lessonUpdate.safeParse({ status: 'SCHEDULED' }).success).toBe(false);
    expect(lessonUpdate.safeParse({ status: 'SCHEDULED', publishAt: new Date(Date.now() - 1000) }).success).toBe(false);
    expect(lessonUpdate.safeParse({ status: 'SCHEDULED', publishAt: new Date(Date.now() + 3600_000) }).success).toBe(true);
  });

  it('reorder takes the full module->lessonIds ordering and rejects extra keys', () => {
    expect(reorderSchema.safeParse({ modules: [{ id: 'm1', lessonIds: ['a', 'b'] }] }).success).toBe(true);
    expect(reorderSchema.safeParse({ modules: [{ id: 'm1' }] }).success).toBe(false);
    expect(reorderSchema.safeParse({ modules: [], extra: 1 }).success).toBe(false);
  });
});
