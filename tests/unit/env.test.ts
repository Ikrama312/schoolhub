import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REQUIRED = {
  DATABASE_URL: 'postgresql://schoolhub:schoolhub@localhost:5432/schoolhub',
  APP_URL: 'http://localhost:3000',
  AUTH_SECRET: 'test-secret',
  NODE_ENV: 'test',
};

const originalEnv = { ...process.env };

async function loadEnvWith(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of Object.keys(REQUIRED)) {
    delete (process.env as Record<string, string | undefined>)[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete (process.env as Record<string, string | undefined>)[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('@/lib/env');
}

describe('env.ts', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads successfully when every required variable is present', async () => {
    const { env } = await loadEnvWith(REQUIRED);
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.NODE_ENV).toBe('test');
  });

  it('defaults NODE_ENV to development when omitted', async () => {
    const { env } = await loadEnvWith({ ...REQUIRED, NODE_ENV: undefined });
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws naming DATABASE_URL when it is missing', async () => {
    await expect(loadEnvWith({ ...REQUIRED, DATABASE_URL: undefined })).rejects.toThrow(/DATABASE_URL/);
  });

  it('throws naming APP_URL when it is missing', async () => {
    await expect(loadEnvWith({ ...REQUIRED, APP_URL: undefined })).rejects.toThrow(/APP_URL/);
  });

  it('throws naming AUTH_SECRET when it is missing', async () => {
    await expect(loadEnvWith({ ...REQUIRED, AUTH_SECRET: undefined })).rejects.toThrow(/AUTH_SECRET/);
  });

  it('throws naming NODE_ENV when it is an invalid value', async () => {
    await expect(loadEnvWith({ ...REQUIRED, NODE_ENV: 'staging' })).rejects.toThrow(/NODE_ENV/);
  });

  it('lists every failing variable in one error, not just the first', async () => {
    await expect(
      loadEnvWith({ DATABASE_URL: undefined, APP_URL: undefined, AUTH_SECRET: undefined }),
    ).rejects.toThrow(/DATABASE_URL[\s\S]*APP_URL[\s\S]*AUTH_SECRET/);
  });
});
