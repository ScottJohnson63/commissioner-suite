/**
 * Applies the auth schema additions to the Turso production database.
 * Run once: npx tsx scripts/migrate-turso.ts
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "name"          TEXT,
    "username"      TEXT UNIQUE,
    "email"         TEXT UNIQUE,
    "emailVerified" DATETIME,
    "image"         TEXT,
    "password"      TEXT,
    "role"          TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS "Account" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "userId"            TEXT NOT NULL,
    "type"              TEXT NOT NULL,
    "provider"          TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token"     TEXT,
    "access_token"      TEXT,
    "expires_at"        INTEGER,
    "token_type"        TEXT,
    "scope"             TEXT,
    "id_token"          TEXT,
    "session_state"     TEXT,
    UNIQUE("provider","providerAccountId"),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "Session" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL UNIQUE,
    "userId"       TEXT NOT NULL,
    "expires"      DATETIME NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token"      TEXT NOT NULL UNIQUE,
    "expires"    DATETIME NOT NULL,
    UNIQUE("identifier","token")
  )`,
];

async function main() {
  for (const sql of statements) {
    await client.execute(sql);
    const tableName = sql.match(/"(\w+)"/)?.[1] ?? '?';
    console.log(`✓ ${tableName}`);
  }
  console.log('Turso schema up to date.');
}

main().catch((err) => { console.error(err); process.exit(1); });
