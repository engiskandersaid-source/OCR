import "server-only";
import { createHash } from "crypto";
import { db } from "@/lib/db";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_HASHES = 2; // each password check uses about 128 MB

type ThrottleRow = { failures: number; window_started_at: number; locked_until: number | null };

// Keyed by username, not IP: x-forwarded-for can be supplied by the client.
const keyFor = (username: string) => createHash("sha256").update(username.trim().toLowerCase()).digest("hex");

export function isLoginLocked(username: string): boolean {
  const row = db().prepare("SELECT locked_until FROM login_throttle WHERE username_key = ?").get(keyFor(username)) as
    | Pick<ThrottleRow, "locked_until">
    | undefined;
  return (row?.locked_until ?? 0) > Date.now();
}

export function recordLoginFailure(username: string) {
  const conn = db();
  const key = keyFor(username);
  const now = Date.now();
  conn
    .transaction(() => {
      conn
        .prepare("DELETE FROM login_throttle WHERE window_started_at < ? AND COALESCE(locked_until, 0) < ?")
        .run(now - DAY_MS, now);
      const row = conn.prepare("SELECT * FROM login_throttle WHERE username_key = ?").get(key) as
        | ThrottleRow
        | undefined;
      const fresh = !row || now - row.window_started_at > WINDOW_MS;
      const failures = fresh ? 1 : row.failures + 1;
      conn
        .prepare(
          `INSERT INTO login_throttle (username_key, failures, window_started_at, locked_until)
           VALUES (@key, @failures, @started, @locked)
           ON CONFLICT(username_key) DO UPDATE SET
             failures = @failures, window_started_at = @started, locked_until = @locked`,
        )
        .run({
          key,
          failures,
          started: fresh ? now : row.window_started_at,
          locked: failures >= MAX_FAILURES ? now + LOCK_MS : null,
        });
    })
    .immediate();
}

export function clearLoginFailures(username: string) {
  db().prepare("DELETE FROM login_throttle WHERE username_key = ?").run(keyFor(username));
}

// ---- In-memory limits (per server process) ----

type Limits = { hashing: number; hits: Map<string, number[]>; analysing: Set<string> };
const globalForLimits = globalThis as unknown as { __virementLimits?: Limits };
const limits: Limits = (globalForLimits.__virementLimits ??= { hashing: 0, hits: new Map(), analysing: new Set() });

/** Runs a password hash if a slot is free; returns null when the server is saturated. */
export async function withHashSlot<T>(work: () => Promise<T>): Promise<T | null> {
  if (limits.hashing >= MAX_CONCURRENT_HASHES) return null;
  limits.hashing++;
  try {
    return await work();
  } finally {
    limits.hashing--;
  }
}

/** Sliding-window counter. Returns false when the limit is already reached. */
export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (limits.hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  limits.hits.set(key, recent);
  return allowed;
}

/** OCR runs one job at a time, so each user gets one analysis at a time. */
export function startAnalysis(userId: string): boolean {
  if (limits.analysing.has(userId)) return false;
  limits.analysing.add(userId);
  return true;
}

export function finishAnalysis(userId: string) {
  limits.analysing.delete(userId);
}
