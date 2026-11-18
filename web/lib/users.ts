import "server-only";
import { randomBytes, randomUUID } from "crypto";
import { hashPassword } from "@/lib/auth/password-core.mjs";
import { revokeUserSessions } from "@/lib/auth/session";
import type { ManagedUser, Role, SessionUser } from "@/lib/auth/types";
import { db } from "@/lib/db";

export const USERNAME_FORMAT = /^[a-z0-9._-]{3,32}$/;
export const MAX_DISPLAY_NAME = 80;

export class UserError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
  must_change_password: number;
  is_active: number;
  created_at: number;
  last_login_at: number | null;
};

const toManaged = (r: UserRow): ManagedUser => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  mustChangePassword: r.must_change_password === 1,
  isActive: r.is_active === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const temporaryPassword = () => randomBytes(15).toString("base64url");

function audit(action: string, actorId: string, targetId: string | null, detail: Record<string, unknown> = {}) {
  db()
    .prepare("INSERT INTO audit_events (at, actor_id, action, target_user_id, detail) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), actorId, action, targetId, JSON.stringify(detail));
}

export { audit as writeAuditEvent };

export function findUserByUsername(username: string): UserRow | undefined {
  return db().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return db().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function hasActiveAdmin(): boolean {
  return db().prepare("SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get() !== undefined;
}

export function markLogin(userId: string) {
  db().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), userId);
}

export function listUsers(): ManagedUser[] {
  const rows = db().prepare("SELECT * FROM users ORDER BY is_active DESC, username").all() as UserRow[];
  return rows.map(toManaged);
}

export async function createUser(
  input: { username: string; displayName: string; role: Role },
  actor: SessionUser,
): Promise<{ user: ManagedUser; temporaryPassword: string }> {
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  const id = randomUUID();
  const now = Date.now();
  const conn = db();
  conn
    .transaction(() => {
      if (findUserByUsername(input.username)) throw new UserError("username_taken", 409);
      conn
        .prepare(
          `INSERT INTO users (id, username, display_name, role, password_hash, must_change_password, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        )
        .run(id, input.username, input.displayName, input.role, hash, now, now);
      audit("user_created", actor.id, id, { role: input.role });
    })
    .immediate();
  return { user: toManaged(findUserById(id)!), temporaryPassword: password };
}

export function updateUser(
  id: string,
  patch: { displayName?: string; role?: Role; isActive?: boolean },
  actor: SessionUser,
): ManagedUser {
  const conn = db();
  conn
    .transaction(() => {
      const target = findUserById(id);
      if (!target) throw new UserError("user_not_found", 404);

      const role = patch.role ?? target.role;
      const active = patch.isActive ?? target.is_active === 1;
      const roleChanged = role !== target.role;
      const activeChanged = active !== (target.is_active === 1);

      if (id === actor.id && (roleChanged || activeChanged)) throw new UserError("cannot_modify_self", 403);

      if (target.role === "admin" && target.is_active === 1 && (role !== "admin" || !active)) {
        const others = conn
          .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?")
          .get(id) as { n: number };
        if (others.n === 0) throw new UserError("last_admin", 409);
      }

      conn
        .prepare("UPDATE users SET display_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?")
        .run(patch.displayName ?? target.display_name, role, active ? 1 : 0, Date.now(), id);

      if (roleChanged) audit("role_changed", actor.id, id, { from: target.role, to: role });
      if (activeChanged) {
        audit(active ? "user_enabled" : "user_disabled", actor.id, id);
        if (!active) revokeUserSessions(id);
      }
    })
    .immediate();
  return toManaged(findUserById(id)!);
}

export async function resetUserPassword(id: string, actor: SessionUser): Promise<string> {
  if (id === actor.id) throw new UserError("cannot_modify_self", 403);
  if (!findUserById(id)) throw new UserError("user_not_found", 404);
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  const conn = db();
  conn
    .transaction(() => {
      conn
        .prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?")
        .run(hash, Date.now(), id);
      revokeUserSessions(id);
      audit("password_reset", actor.id, id);
    })
    .immediate();
  return password;
}

/** Sets the user's own new password and signs out all of their sessions. */
export function saveOwnPassword(userId: string, hash: string) {
  const conn = db();
  conn
    .transaction(() => {
      conn
        .prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
        .run(hash, Date.now(), userId);
      revokeUserSessions(userId);
    })
    .immediate();
}
