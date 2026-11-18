#!/usr/bin/env node
/**
 * Creates the first admin, or restores admin access to an existing account.
 *   npm run create-admin -- <username>
 * The password is typed at a hidden prompt, so it never appears in arguments or shell history.
 */
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { hashPassword, passwordProblem, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "../lib/auth/password-core.mjs";
import { openDatabase } from "../lib/db-migrate.mjs";

const USERNAME_FORMAT = /^[a-z0-9._-]{3,32}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function promptHidden(label) {
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0008" || ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on("data", onData);
  });
}

async function readPasswords() {
  if (process.stdin.isTTY) {
    return [await promptHidden("Password: "), await promptHidden("Confirm password: ")];
  }
  // Piped input: the first two lines.
  const lines = [];
  for await (const line of readline.createInterface({ input: process.stdin })) {
    lines.push(line);
    if (lines.length === 2) break;
  }
  return [lines[0] ?? "", lines[1] ?? ""];
}

const username = (process.argv[2] ?? "").trim().toLowerCase();
if (!USERNAME_FORMAT.test(username)) {
  fail("Usage: npm run create-admin -- <username>\nUsername: 3 to 32 characters among a-z, 0-9, dot, dash, underscore.");
}

console.log(`Password for "${username}" (${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters).`);
const [password, confirmation] = await readPasswords();
if (password !== confirmation) fail("The passwords do not match. Nothing was changed.");
const problem = passwordProblem(password);
if (problem) fail(`The password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters. Nothing was changed.`);

const hash = await hashPassword(password);
const conn = openDatabase();
const now = Date.now();

const created = conn
  .transaction(() => {
    const existing = conn.prepare("SELECT id FROM users WHERE username = ?").get(username);
    const id = existing?.id ?? randomUUID();
    if (existing) {
      conn
        .prepare(
          `UPDATE users SET role = 'admin', is_active = 1, must_change_password = 0, password_hash = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(hash, now, id);
      conn.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    } else {
      conn
        .prepare(
          `INSERT INTO users (id, username, display_name, role, password_hash, must_change_password, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 'admin', ?, 0, 1, ?, ?)`,
        )
        .run(id, username, username, hash, now, now);
    }
    conn.prepare("DELETE FROM login_throttle").run();
    conn
      .prepare("INSERT INTO audit_events (at, actor_id, action, target_user_id, detail) VALUES (?, NULL, ?, ?, '{}')")
      .run(now, existing ? "admin_restored" : "admin_created", id);
    return !existing;
  })
  .immediate();

conn.close();
console.log(created ? `Admin "${username}" created.` : `Admin access restored for "${username}". Their sessions were signed out.`);
