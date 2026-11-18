import { jsonError, jsonOk, requireApi } from "@/lib/auth/guard";
import { scopeFor } from "@/lib/auth/types";
import { clearAllTransfers, listTransfers } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Transfers the signed-in user may see, newest first. */
export async function GET(req: Request) {
  const access = await requireApi(req);
  if (!access.ok) return access.response;
  try {
    return jsonOk({ items: await listTransfers(scopeFor(access.session.user)) });
  } catch (e) {
    console.error(e);
    return jsonError("store_failed", 500);
  }
}

/** Clears the whole store. Admin only. */
export async function DELETE(req: Request) {
  const access = await requireApi(req, { admin: true });
  if (!access.ok) return access.response;
  try {
    return jsonOk({ ok: true, deleted: await clearAllTransfers(access.session.user) });
  } catch (e) {
    console.error(e);
    return jsonError("store_failed", 500);
  }
}
