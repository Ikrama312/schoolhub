import { z } from 'zod';

/**
 * Fail-fast env validation. Runs once at module load (startup boundary) —
 * anything importing this module gets a readable error naming every
 * missing/invalid variable instead of an undefined-at-runtime surprise.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.string().min(1, 'APP_URL is required'),
  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Email (PRD-04). EMAIL_TRANSPORT defaults to 'console' so dev/test never
  // need real SMTP creds; the smtp branch (src/server/email/transport.ts)
  // only reads SMTP_*/EMAIL_FROM when EMAIL_TRANSPORT='smtp'.
  EMAIL_TRANSPORT: z.enum(['smtp', 'console']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  EMAIL_FROM: z.string().optional(),
  // Bearer token for POST /api/internal/email/dispatch (NFR-8). Optional so
  // existing .env files don't break; left unset, the route rejects every
  // request (fail-safe, not fail-open).
  CRON_SECRET: z.string().optional(),

  // File storage (PRD-08 FR-2/FR-4). Local disk only, outside public/ (NFR-11).
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
