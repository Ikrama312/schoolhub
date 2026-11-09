import type { FileObject } from '@prisma/client';
import { registerBuiltInContexts } from './contexts';

/**
 * File access registry (PRD-08 FR-9, NFR-1). Every download goes through
 * canAccessFile. Later PRDs call registerFileAccess for their own contexts.
 */

export interface FileAccessUser {
  id: string;
  role: string;
}

export type FileAccessFile = Pick<FileObject, 'id' | 'ownerId' | 'context' | 'contextId'>;

/** Resolvers receive null for anonymous callers; only return true for null if the context is public. */
export type FileAccessResolver = (user: FileAccessUser | null, file: FileAccessFile) => boolean | Promise<boolean>;

const registry = new Map<string, FileAccessResolver>();

export function registerFileAccess(context: string, resolver: FileAccessResolver): void {
  registry.set(context, resolver);
}

const ownerOrAdmin = (user: FileAccessUser | null, file: FileAccessFile) =>
  user !== null && (user.role === 'ADMIN' || user.id === file.ownerId);

let builtInsRegistered = false;

/**
 * Dispatch order: (1) unattached -> owner/ADMIN; (2) registered resolver;
 * (3) unknown context -> owner/ADMIN. Anonymous is denied except where a
 * resolver explicitly accepts null. Resolver errors deny.
 */
export async function canAccessFile(user: FileAccessUser | null, file: FileAccessFile): Promise<boolean> {
  // Lazy so the circular import with contexts.ts never hits an uninitialised registry,
  // and no caller can forget to load the built-in contexts.
  if (!builtInsRegistered) {
    builtInsRegistered = true;
    registerBuiltInContexts(registerFileAccess);
  }
  if (file.contextId === null) return ownerOrAdmin(user, file);
  const resolver = registry.get(file.context);
  if (!resolver) return ownerOrAdmin(user, file);
  try {
    return (await resolver(user, file)) === true;
  } catch {
    return false;
  }
}
