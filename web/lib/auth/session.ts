import "server-only";
import { createHash, randomBytes } from "crypto";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import type { Role, SessionUser } from "@/lib/auth/types";
import { db } from "@/lib/db";

const IDLE_MS = 2 * 60 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The public address of the app. Outside development it must be configured. */
export function appOrigin(): string | null {
  const configured = process.env.APP_ORIGIN;
  if (!configured) return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function cookieBase() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    // Browsers silently drop Secure cookies on plain http, so this follows the real address.
    secure: appOrigin()?.startsWith("https://") ?? true,
    path: "/",
  };
}

export const sessionCookie = (token: string) => ({ ...cookieBase(), value: token, maxAge: ABSOLUTE_MS / 1000 });
export const clearedSessionCookie = () => ({ ...cookieBase(), value: "", maxAge: 0 });

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const conn = db();
  conn.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").run(now, now - IDLE_MS);
  conn
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(hashToken(token), userId, now, now, now + ABSOLUTE_MS);
  return token;
}

type SessionRow = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  must_change_password: number;
  last_seen_at: number;
};

/** Role and active status are read on every call, so changes apply immediately. */
export function validateSession(token: string): SessionUser | null {
  if (!TOKEN_FORMAT.test(token)) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = db()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.must_change_password, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ? AND u.is_active = 1`,
    )
    .get(tokenHash, now, now - IDLE_MS) as SessionRow | undefined;
  if (!row) return null;

  if (now - row.last_seen_at > TOUCH_EVERY_MS) {
    db().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, tokenHash);
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function deleteSession(token: string) {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function revokeUserSessions(userId: string) {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
