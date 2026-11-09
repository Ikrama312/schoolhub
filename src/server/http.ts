import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { logger } from '@/lib/logger';

/**
 * The one chokepoint every route handler goes through. Nothing here should
 * be reimplemented per-route — new endpoints import from this module, they
 * don't hand-roll envelopes, pagination clamping or error mapping.
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_TOKEN';

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_TOKEN: 410,
};

/** Throw this from a handler for a known, intentional failure. */
export class AppError extends Error {
  code: ApiErrorCode;
  details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function paginated<T>(
  data: T[],
  meta: { page: number; pageSize: number; total: number },
  init?: ResponseInit,
) {
  return NextResponse.json({ data, meta }, init);
}

export function apiError(code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status: ERROR_STATUS[code] },
  );
}

/**
 * Wraps a route handler, mapping thrown errors to the shared envelope:
 * ZodError -> VALIDATION_ERROR (400, flattened field errors in details)
 * AppError -> its own code/status
 * Prisma P2002 -> CONFLICT, P2025 -> NOT_FOUND
 * anything else -> INTERNAL (500), stack logged, never returned to client
 */
export function withHandler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        return apiError('VALIDATION_ERROR', 'Invalid request', error.flatten());
      }

      if (error instanceof AppError) {
        return apiError(error.code, error.message, error.details);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return apiError('CONFLICT', 'Resource already exists', { target: error.meta?.target });
        }
        if (error.code === 'P2025') {
          return apiError('NOT_FOUND', 'Resource not found');
        }
      }

      logger.error('Unhandled error in route handler', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return apiError('INTERNAL', 'Internal server error');
    }
  };
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

const MAX_PAGE_SIZE = 100;

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const rawPage = Number(searchParams.get('page'));
  const rawPageSize = Number(searchParams.get('pageSize'));

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSizeRequested = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.floor(rawPageSize) : 20;
  const pageSize = Math.min(pageSizeRequested, MAX_PAGE_SIZE);

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

// Typed on the schema's *output* so .default()/.transform()/preprocess fields come back resolved.
export async function parseBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<output<S>> {
  const json = await request.json().catch(() => ({}));
  return schema.parse(json);
}

/** First x-forwarded-for entry (the client, behind our proxy), or null. */
export function getClientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export function parseQuery<S extends ZodTypeAny>(searchParams: URLSearchParams, schema: S): output<S> {
  return schema.parse(Object.fromEntries(searchParams.entries()));
}
