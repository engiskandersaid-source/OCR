import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { jsonError, jsonOk, originAllowed, readJsonObject } from "@/lib/auth/guard";
import { MAX_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password-core.mjs";
import { createSession, deleteSession, sessionCookie } from "@/lib/auth/session";
import { clearLoginFailures, isLoginLocked, recordLoginFailure, withHashSlot } from "@/lib/auth/throttle";
import { findUserByUsername, markLogin, USERNAME_FORMAT } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!originAllowed(req)) return jsonError("bad_origin", 403);

  const body = await readJsonObject(req);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  // A name in the wrong format cannot exist, so no hashing or throttle row is needed.
  if (!USERNAME_FORMAT.test(username) || !password || password.length > MAX_PASSWORD_LENGTH) {
    return jsonError("invalid_credentials", 401);
  }
  if (isLoginLocked(username)) return jsonError("rate_limited", 429);

  const outcome = await withHashSlot(async () => {
    const user = findUserByUsername(username);
    if (!user) return { user: null, valid: await verifyAgainstDummy(password) };
    return { user, valid: await verifyPassword(password, user.password_hash) };
  });
  if (!outcome) return jsonError("rate_limited", 429);

  if (!outcome.user || !outcome.valid || outcome.user.is_active !== 1) {
    recordLoginFailure(username);
    return jsonError("invalid_credentials", 401);
  }

  clearLoginFailures(username);
  markLogin(outcome.user.id);
  const previous = (await cookies()).get(SESSION_COOKIE)?.value;
  if (previous) deleteSession(previous);

  const response = jsonOk({ mustChangePassword: outcome.user.must_change_password === 1 });
  response.cookies.set(sessionCookie(createSession(outcome.user.id)));
  return response;
}
