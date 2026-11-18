import { jsonError, jsonOk, readJsonObject, requireApi } from "@/lib/auth/guard";
import type { Role } from "@/lib/auth/types";
import { MAX_DISPLAY_NAME, updateUser, UserError } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = new Set(["displayName", "role", "isActive"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireApi(req, { admin: true });
  if (!access.ok) return access.response;

  const body = await readJsonObject(req);
  if (!body || Object.keys(body).length === 0 || Object.keys(body).some((k) => !ALLOWED_KEYS.has(k))) {
    return jsonError("invalid_body", 400);
  }

  const patch: { displayName?: string; role?: Role; isActive?: boolean } = {};
  if (body.displayName !== undefined) {
    const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!name || name.length > MAX_DISPLAY_NAME) return jsonError("invalid_display_name", 400);
    patch.displayName = name;
  }
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "employee") return jsonError("invalid_role", 400);
    patch.role = body.role;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return jsonError("invalid_body", 400);
    patch.isActive = body.isActive;
  }

  try {
    const { id } = await ctx.params;
    return jsonOk({ user: updateUser(id, patch, access.session.user) });
  } catch (e) {
    if (e instanceof UserError) return jsonError(e.code, e.status);
    console.error("[users] update failed:", e);
    return jsonError("internal", 500);
  }
}
