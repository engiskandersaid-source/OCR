import { jsonOk, requireApi } from "@/lib/auth/guard";
import { clearedSessionCookie, deleteSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const access = await requireApi(req, { allowPasswordChange: true });
  if (!access.ok) return access.response;

  deleteSession(access.session.token);
  const response = jsonOk({ ok: true });
  response.cookies.set(clearedSessionCookie());
  return response;
}
