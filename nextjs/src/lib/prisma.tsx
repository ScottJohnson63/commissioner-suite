// src/lib/prisma.tsx
//
// Singleton Prisma client wired to the Turso (libSQL) database.
//
// Why singleton: Next.js hot-reloads in development create a new module scope
// on every change, which would spawn a new connection pool each time. Storing
// the client on `global` makes it survive hot-reloads so we never exceed the
// Turso connection limit during local development.
//
// In production the module is imported once per process, so the guard is a
// no-op — but it keeps the pattern consistent.
//
// Required env vars:
//   TURSO_DATABASE_URL  — libSQL URL for the Turso database (e.g. libsql://…)
//   TURSO_AUTH_TOKEN    — Auth token for the Turso database (can be omitted for
//                         local SQLite via file: URLs in development)

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

/** Creates a new Prisma client connected to the Turso (libSQL) database. */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return new PrismaClient({ adapter });
}

/**
 * Builds the client on first real use rather than at module load.
 *
 * `@/lib/prisma` gets pulled in by modules that only want an unrelated
 * constant sitting next to a query function (see customize.ts), and those
 * imports can reach purely client-side code. Constructing the client eagerly
 * meant merely importing this module — never calling it — threw whenever
 * TURSO_DATABASE_URL was not set, which is normal outside a server process.
 */
let client: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
  // Pin to globalThis only in dev so that hot-reloads reuse the existing
  // client rather than opening a fresh connection pool on every file change.
  // In production the module is imported once per process, so this module
  // -scope cache is all that is needed.
  client ??= globalForPrisma.prisma ?? createPrismaClient();
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
}

/** Shared Prisma client — reused across hot-reloads in development. */
export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop, receiver) => Reflect.get(getPrismaClient(), prop, receiver),
});