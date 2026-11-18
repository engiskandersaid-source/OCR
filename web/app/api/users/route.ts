import { jsonError, jsonOk, readJsonObject, requireApi } from "@/lib/auth/guard";
import { withHashSlot } from "@/lib/auth/throttle";
import { createUser, listUsers, MAX_DISPLAY_NAME, USERNAME_FORMAT, UserError } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const access = await requireApi(req, { admin: true });
  if (!access.ok) return access.response;
  return jsonOk({ users: listUsers() });
}

export async function POST(req: Request) {
  const access = await requireApi(req, { admin: true });
  if (!access.ok) return access.response;

  const body = await readJsonObject(req);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const role = body?.role;
  if (!USERNAME_FORMAT.test(username)) return jsonError("invalid_username", 400);
  if (!displayName || displayName.length > MAX_DISPLAY_NAME) return jsonError("invalid_display_name", 400);
  if (role !== "admin" && role !== "employee") return jsonError("invalid_role", 400);

  try {
    const created = await withHashSlot(() => createUser({ username, displayName, role }, access.session.user));
    return created ? jsonOk(created, 201) : jsonError("rate_limited", 429);
  } catch (e) {
    if (e instanceof UserError) return jsonError(e.code, e.status);
    console.error("[users] create failed:", e);
    return jsonError("internal", 500);
  }
}
