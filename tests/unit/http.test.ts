import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, ok, paginated, apiError, withHandler, parsePagination, parseBody, parseQuery } from '@/server/http';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ok/paginated/apiError envelopes', () => {
  it('ok() wraps the payload in { data }', async () => {
    const res = ok({ foo: 'bar' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { foo: 'bar' } });
  });

  it('paginated() includes data + meta', async () => {
    const res = paginated([1, 2], { page: 1, pageSize: 20, total: 2 });
    expect(await res.json()).toEqual({ data: [1, 2], meta: { page: 1, pageSize: 20, total: 2 } });
  });

  it('apiError() maps each code to its documented status', async () => {
    expect((await apiError('VALIDATION_ERROR', 'bad')).status).toBe(400);
    expect((await apiError('NOT_FOUND', 'missing')).status).toBe(404);
    expect((await apiError('CONFLICT', 'dupe')).status).toBe(409);
    expect((await apiError('INTERNAL', 'boom')).status).toBe(500);
    const res = apiError('NOT_FOUND', 'missing', { id: '1' });
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'missing', details: { id: '1' } } });
  });
});

describe('withHandler error mapping', () => {
  it('maps ZodError to VALIDATION_ERROR (400)', async () => {
    const handler = withHandler(async () => {
      z.object({ name: z.string() }).parse({});
      throw new Error('unreachable');
    });
    const res = await handler();
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps AppError to its own code/status', async () => {
    const handler = withHandler(async () => {
      throw new AppError('CONFLICT', 'already exists');
    });
    const res = await handler();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: 'CONFLICT', message: 'already exists' });
  });

  it('maps Prisma P2002 to CONFLICT', async () => {
    const handler = withHandler(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.20.0',
        meta: { target: ['email'] },
      });
    });
    const res = await handler();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('maps Prisma P2025 to NOT_FOUND', async () => {
    const handler = withHandler(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.20.0',
      });
    });
    const res = await handler();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('maps anything else to INTERNAL (500) without leaking the message', async () => {
    const handler = withHandler(async () => {
      throw new Error('some internal secret detail');
    });
    const res = await handler();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('secret');
  });

  it('passes through a successful response untouched', async () => {
    const handler = withHandler(async () => ok({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(200);
  });
});

describe('parsePagination', () => {
  it('defaults to page 1 / pageSize 20', () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('clamps pageSize to a max of 100', () => {
    expect(parsePagination(new URLSearchParams('pageSize=500')).pageSize).toBe(100);
  });

  it('clamps page to a minimum of 1', () => {
    expect(parsePagination(new URLSearchParams('page=0')).page).toBe(1);
    expect(parsePagination(new URLSearchParams('page=-5')).page).toBe(1);
  });

  it('computes skip/take from page/pageSize', () => {
    expect(parsePagination(new URLSearchParams('page=3&pageSize=10'))).toEqual({
      page: 3,
      pageSize: 10,
      skip: 20,
      take: 10,
    });
  });

  it('falls back to defaults on non-numeric input', () => {
    expect(parsePagination(new URLSearchParams('page=abc&pageSize=xyz'))).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });
});

describe('parseBody / parseQuery', () => {
  const schema = z.object({ name: z.string() });

  it('parseBody resolves parsed JSON matching the schema', async () => {
    const request = new Request('http://test', { method: 'POST', body: JSON.stringify({ name: 'Ada' }) });
    await expect(parseBody(request, schema)).resolves.toEqual({ name: 'Ada' });
  });

  it('parseBody throws ZodError on invalid JSON body', async () => {
    const request = new Request('http://test', { method: 'POST', body: JSON.stringify({}) });
    await expect(parseBody(request, schema)).rejects.toBeInstanceOf(ZodError);
  });

  it('parseQuery parses URLSearchParams against the schema', () => {
    expect(parseQuery(new URLSearchParams('name=Ada'), schema)).toEqual({ name: 'Ada' });
  });

  it('parseQuery throws ZodError when a required field is missing', () => {
    expect(() => parseQuery(new URLSearchParams(''), schema)).toThrow(ZodError);
  });
});
