import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { appOrigin, validateSession } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";

export type Session = { user: SessionUser; token: string };

const noStore = { "Cache-Control": "no-store" };

export const jsonError = (code: string, status: number) =>
  NextResponse.json({ code }, { status, headers: noStore });

export const jsonOk = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = validateSession(token);
  return user ? { user, token } : null;
}

/** Compared with the configured address, never with the Host header, which can be forged. */
export function originAllowed(req: Request): boolean {
  const expected = appOrigin();
  return expected !== null && req.headers.get("origin") === expected;
}

// ---- Server pages ----

export async function requirePageUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword && !opts.allowPasswordChange) redirect("/account/password");
  return session.user;
}

export async function requirePageAdmin(): Promise<SessionUser> {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

// ---- Route handlers ----

type ApiAccess = { ok: true; session: Session } | { ok: false; response: NextResponse };

export async function requireApi(
  req: Request,
  opts: { admin?: boolean; allowPasswordChange?: boolean } = {},
): Promise<ApiAccess> {
  const deny = (code: string, status: number): ApiAccess => ({ ok: false, response: jsonError(code, status) });

  if (req.method !== "GET" && req.method !== "HEAD" && !originAllowed(req)) return deny("bad_origin", 403);
  const session = await getSession();
  if (!session) return deny("unauthenticated", 401);
  if (session.user.mustChangePassword && !opts.allowPasswordChange) return deny("password_change_required", 403);
  if (opts.admin && session.user.role !== "admin") return deny("forbidden", 403);
  return { ok: true, session };
}

/** Parses a small JSON object body. Returns null for anything else. */
export async function readJsonObject(req: Request, maxChars = 4096): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.text();
    if (raw.length > maxChars) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
