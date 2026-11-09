import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton cached on globalThis. Next.js dev hot-reload
 * re-evaluates this module on every edit; without the cache that creates a
 * new PrismaClient (and a new Postgres connection pool) each time until the
 * db runs out of connections. Standard Next.js + Prisma pattern.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
