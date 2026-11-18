import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Fast pre-filter only: it checks that a cookie exists, not that it is valid.
 * The real checks are in lib/auth/guard.ts, in every page and route handler.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ code: "unauthenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // /api/extract is excluded because middleware truncates request bodies at 10 MiB, which
  // could cut off a PDF near the upload limit. Its handler performs the full check itself.
  matcher: ["/((?!_next/|favicon\\.ico$|login$|api/auth/login$|api/extract$).*)"],
};
