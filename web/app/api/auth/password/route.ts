import { jsonError, jsonOk, readJsonObject, requireApi } from "@/lib/auth/guard";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password-core.mjs";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { allowRequest, withHashSlot } from "@/lib/auth/throttle";
import { findUserById, saveOwnPassword } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Changes the signed-in user's password, signs out their other sessions and issues a new one. */
export async function POST(req: Request) {
  const access = await requireApi(req, { allowPasswordChange: true });
  if (!access.ok) return access.response;
  const { user } = access.session;

  const body = await readJsonObject(req);
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!current || !next) return jsonError("invalid_body", 400);

  const problem = passwordProblem(next);
  if (problem) return jsonError(problem, 400);
  if (next === current) return jsonError("same_password", 400);
  if (!allowRequest(`password:${user.id}`, ATTEMPTS, WINDOW_MS)) return jsonError("rate_limited", 429);

  const row = findUserById(user.id);
  if (!row) return jsonError("unauthenticated", 401);

  const hash = await withHashSlot(async () =>
    (await verifyPassword(current, row.password_hash)) ? await hashPassword(next) : "",
  );
  if (hash === null) return jsonError("rate_limited", 429);
  // Not a 401: the session is valid, only the typed password is wrong.
  if (!hash) return jsonError("invalid_current_password", 400);

  saveOwnPassword(user.id, hash);
  const response = jsonOk({ ok: true });
  response.cookies.set(sessionCookie(createSession(user.id)));
  return response;
}
