"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { TRANSFERS_CHANGED_EVENT } from "@/components/ChatWidget";
import { Dropzone } from "@/components/Dropzone";
import { History } from "@/components/History";
import { ResultCard } from "@/components/ResultCard";
import { Stepper, type Stage } from "@/components/Stepper";
import { apiFetch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { ExtractResult, HistoryItem, OcrLine } from "@/lib/types";

type Event =
  | { stage: "ocr" }
  | { stage: "llm"; ocr: OcrLine[] }
  | { stage: "done"; result: ExtractResult; item?: HistoryItem | null }
  | { stage: "error"; code: string };

export function HomeClient() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [failedAt, setFailedAt] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrLine[]>([]);
  const [result, setResult] = useState<{ data: ExtractResult; fileName: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // The history lives on the server (SQLite, web/data/virementocr.db): load it on mount.
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch("/api/transfers", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: HistoryItem[] } | null) => {
        if (j && Array.isArray(j.items)) setHistory(j.items);
      })
      .catch(() => {
        /* offline or aborted: keep the empty state */
      });
    return () => ctrl.abort();
  }, []);

  const clearHistory = async () => {
    const previous = history;
    setHistory([]);
    try {
      const res = await apiFetch("/api/transfers", { method: "DELETE" });
      if (!res.ok) throw new Error("clear failed");
      window.dispatchEvent(new Event(TRANSFERS_CHANGED_EVENT));
    } catch {
      setHistory(previous); // the store was not cleared: show what is really there
    }
  };

  const busy = stage === "upload" || stage === "ocr" || stage === "llm";

  const analyze = async () => {
    if (!file || busy) return;
    setResult(null);
    setError(null);
    setFailedAt(null);
    setOcr([]);
    setStage("upload");

    let last: Stage = "upload";
    const fail = (code: string) => {
      setFailedAt(last);
      setStage("error");
      setError(t.errors[code] ?? t.errors.network);
    };

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch("/api/extract", { method: "POST", body });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        return fail(j.code ?? "network");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          const ev = JSON.parse(raw) as Event;
          if (ev.stage === "ocr") {
            last = "ocr";
            setStage("ocr");
          } else if (ev.stage === "llm") {
            last = "llm";
            setOcr(ev.ocr);
            setStage("llm");
          } else if (ev.stage === "done") {
            setStage("done");
            setResult({ data: ev.result, fileName: file.name });
            // `item` is the record the server saved (null when the document is not a transfer).
            const saved = ev.item;
            if (saved) {
              setHistory((h) => [saved, ...h.filter((x) => x.id !== saved.id)]);
              window.dispatchEvent(new Event(TRANSFERS_CHANGED_EVENT));
            }
          } else if (ev.stage === "error") {
            return fail(ev.code);
          }
        }
      }
    } catch {
      fail("network");
    }
  };

  return (
    <AppFrame>
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
        {/* Hero */}
        <section className="pb-8 pt-12 text-center sm:pb-12 sm:pt-20">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/60 bg-white/70 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur"
          >
            <Sparkles className="size-3.5" />
            {t.badge}
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6, ease: "easeOut" }}
            className="mx-auto mt-5 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl"
          >
            {t.heroTitle1}{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent">
              {t.heroTitle2}
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
            className="mx-auto mt-5 max-w-2xl text-base text-slate-600 sm:text-lg"
          >
            {t.heroSub}
          </motion.p>
        </section>

        {/* Workspace */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-4xl space-y-5"
        >
          <Dropzone
            file={file}
            busy={busy}
            onFile={(f) => {
              setFile(f);
              if (!f) {
                setStage("idle");
                setError(null);
              }
            }}
            onAnalyze={analyze}
          />

          <AnimatePresence>
            {stage !== "idle" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Stepper stage={stage} failedAt={failedAt} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, x: 0 }}
                animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45 }}
                className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700"
              >
                <AlertOctagon className="mt-0.5 size-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {result && (
              <ResultCard key={result.fileName} result={result.data} ocr={ocr} fileName={result.fileName} />
            )}
          </AnimatePresence>
        </motion.div>

        <div className="mx-auto mt-14 max-w-4xl sm:mt-20">
          <History items={history} onClear={clearHistory} />
        </div>
      </main>

      <footer className="border-t border-slate-200/60 px-4 pb-28 pt-6 text-center text-xs text-slate-400">{t.footer}</footer>
    </AppFrame>
  );
}
