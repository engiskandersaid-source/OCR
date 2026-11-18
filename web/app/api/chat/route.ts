import { NextResponse } from "next/server";
import { requireApi } from "@/lib/auth/guard";
import { validateSession } from "@/lib/auth/session";
import { allowRequest } from "@/lib/auth/throttle";
import { scopeFor } from "@/lib/auth/types";
import { errorCode, hasApiKey, runChat, type ChatEvent, type ChatLocale, type ChatTurn } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MESSAGES = 24;
const MAX_CHARS = 1000;
const MAX_BODY_CHARS = 200_000;
const REQUESTS_PER_MINUTE = 20;

type Parsed = { ok: true; turns: ChatTurn[]; locale: ChatLocale } | { ok: false; code: string };

/** Strict validation of the request body. Nothing from the client is trusted. */
function parseBody(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, code: "invalid_body" };
  const { messages, locale } = body as Record<string, unknown>;

  if (locale !== "fr" && locale !== "en") return { ok: false, code: "invalid_locale" };
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, code: "invalid_messages" };

  const turns: ChatTurn[] = [];
  // Only the most recent messages are kept.
  for (const m of messages.slice(-MAX_MESSAGES)) {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return { ok: false, code: "invalid_message" };
    const { role, content } = m as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return { ok: false, code: "invalid_role" };
    if (typeof content !== "string" || content.trim().length === 0) return { ok: false, code: "invalid_content" };
    if (content.length > MAX_CHARS) return { ok: false, code: "message_too_long" };
    turns.push({ role, content });
  }

  if (turns[turns.length - 1].role !== "user") return { ok: false, code: "last_not_user" };
  // The window may start mid-exchange: a conversation always opens with the user.
  while (turns[0].role !== "user") turns.shift();

  return { ok: true, turns, locale };
}

const json = (code: string, status: number) =>
  NextResponse.json({ type: "error", code }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Streams NDJSON, same style as /api/extract:
 *   {"type":"status","status":"searching"} | {"type":"delta","text":"..."} | {"type":"done"}
 *   or {"type":"error","code":"..."}
 */
export async function POST(req: Request) {
  const access = await requireApi(req);
  if (!access.ok) return access.response;
  const { user, token } = access.session;

  if (!allowRequest(`chat:${user.id}`, REQUESTS_PER_MINUTE, 60_000)) return json("rate_limit", 429);
  if (!hasApiKey()) return json("no_api_key", 503);

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return json("body_too_large", 413);
    body = JSON.parse(raw);
  } catch {
    return json("invalid_json", 400);
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return json(parsed.code, 400);

  // Aborts the upstream request when the browser disconnects or cancels the stream.
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener("abort", onAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (ev: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          open = false;
        }
      };

      try {
        await runChat({
          turns: parsed.turns,
          locale: parsed.locale,
          signal: abort.signal,
          emit,
          ownTransfersOnly: user.role !== "admin",
          // Re-checked before every search: access can be revoked during a long stream.
          authorize: () => {
            const current = validateSession(token);
            return current && !current.mustChangePassword ? scopeFor(current) : null;
          },
        });
      } catch (e) {
        const code = abort.signal.aborted ? null : errorCode(e);
        if (code) {
          // Log server-side only; the browser gets a code, never the raw error.
          console.error("[chat]", e instanceof Error ? `${e.name}: ${e.message}` : "unknown error");
          emit({ type: "error", code });
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        if (open) {
          try {
            controller.close();
          } catch {
            /* already closed by a cancel */
          }
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
