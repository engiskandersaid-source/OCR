import { jsonError, jsonOk, requireApi } from "@/lib/auth/guard";
import { withHashSlot } from "@/lib/auth/throttle";
import { resetUserPassword, UserError } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues a temporary password, shown once to the admin, and signs the user out everywhere. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireApi(req, { admin: true });
  if (!access.ok) return access.response;

  try {
    const { id } = await ctx.params;
    const temporaryPassword = await withHashSlot(() => resetUserPassword(id, access.session.user));
    return temporaryPassword ? jsonOk({ temporaryPassword }) : jsonError("rate_limited", 429);
  } catch (e) {
    if (e instanceof UserError) return jsonError(e.code, e.status);
    console.error("[users] password reset failed:", e);
    return jsonError("internal", 500);
  }
}
