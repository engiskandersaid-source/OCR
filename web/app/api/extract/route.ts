import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireApi } from "@/lib/auth/guard";
import { allowRequest, finishAnalysis, startAnalysis } from "@/lib/auth/throttle";
import { extractFromOcr, type OcrLine } from "@/lib/extract";
import { addTransfer } from "@/lib/store";
import type { HistoryItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const OCR_URL = process.env.OCR_SERVICE_URL || "http://127.0.0.1:8001";
const MAX_BYTES = 10 * 1024 * 1024;
const MULTIPART_OVERHEAD = 64 * 1024;
const HOURLY_LIMIT = 60;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Streams NDJSON events so the UI can show real progress:
 *   {"stage":"ocr"} -> {"stage":"llm","ocr":[...]} -> {"stage":"done","result":{...},"item":{...}|null}
 *   (`item` is the record saved in the store; null when the document is not a bank transfer)
 *   or {"stage":"error","code":"..."}. Only codes are sent: the UI translates them.
 */
export async function POST(req: Request) {
  // Authentication and the size check come before the body is parsed.
  const access = await requireApi(req);
  if (!access.ok) return access.response;
  const { user } = access.session;

  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) return fail("no_file", 400);
  if (length > MAX_BYTES + MULTIPART_OVERHEAD) return fail("too_large", 413);

  if (!startAnalysis(user.id)) return fail("busy", 429);
  let handedToStream = false;

  try {
    if (!allowRequest(`extract:${user.id}`, HOURLY_LIMIT, HOUR_MS)) return fail("rate_limited", 429);

    let file: File | null = null;
    try {
      const f = (await req.formData()).get("file");
      if (f instanceof File) file = f;
    } catch {
      /* handled below */
    }

    if (!file) return fail("no_file", 400);
    if (file.size > MAX_BYTES) return fail("too_large", 413);
    if (file.type && file.type !== "application/pdf") return fail("not_pdf", 400);

    const pdf = file;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        const error = (code: string) => send({ stage: "error", code });

        try {
          // ---- Phase 1: OCR (PaddleOCR service) ----
          send({ stage: "ocr" });
          let lines: OcrLine[];
          try {
            const fwd = new FormData();
            fwd.append("file", pdf, pdf.name || "document.pdf");
            const res = await fetch(`${OCR_URL}/ocr`, {
              method: "POST",
              body: fwd,
              headers: { "X-OCR-Token": process.env.OCR_SERVICE_TOKEN ?? "" },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              console.error(`[extract] OCR service answered ${res.status}`);
              return error(res.status === 400 ? "pdf_rejected" : res.status === 413 ? "too_large" : "ocr_failed");
            }
            lines = body.lines ?? [];
          } catch (e) {
            console.error("[extract] OCR service unreachable:", e instanceof Error ? e.message : e);
            return error("ocr_unreachable");
          }
          if (lines.length === 0) return error("no_text");

          // ---- Phase 2: LLM extraction ----
          send({ stage: "llm", ocr: lines });
          const result = await extractFromOcr(lines);

          // Persist the extracted fields only (never the PDF or the OCR text), and only
          // for real bank transfers. A store failure must not fail the extraction.
          let item: HistoryItem | null = null;
          if (result.is_bank_transfer) {
            try {
              item = await addTransfer(
                {
                  id: randomUUID(),
                  fileName: (pdf.name || "document.pdf").slice(0, 200),
                  at: Date.now(),
                  ...(user.role === "admin" ? { owner: user.displayName } : {}),
                  result,
                },
                user.id,
              );
            } catch (e) {
              console.error("Could not save the transfer:", e);
            }
          }

          send({ stage: "done", result, item });
        } catch (e) {
          console.error(e);
          try {
            error("llm_failed");
          } catch {
            /* the client already went away */
          }
        } finally {
          finishAnalysis(user.id);
          try {
            controller.close();
          } catch {
            /* already closed by a cancel */
          }
        }
      },
    });

    handedToStream = true;
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } finally {
    if (!handedToStream) finishAnalysis(user.id);
  }
}

function fail(code: string, status: number) {
  return NextResponse.json({ stage: "error", code }, { status, headers: { "Cache-Control": "no-store" } });
}
