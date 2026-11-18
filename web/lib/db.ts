import "server-only";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db-migrate.mjs";

// Next.js reloads modules in development: keep a single connection per process.
const globalForDb = globalThis as unknown as { __virementDbV1?: Database.Database };

export function db(): Database.Database {
  globalForDb.__virementDbV1 ??= openDatabase();
  return globalForDb.__virementDbV1;
}
