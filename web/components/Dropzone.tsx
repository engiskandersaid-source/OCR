"use client";

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FileText, Loader2, Sparkles, UploadCloud, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useI18n } from "@/lib/i18n";

const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  file: File | null;
  busy: boolean;
  onFile: (f: File | null) => void;
  onAnalyze: () => void;
};

export function Dropzone({ file, busy, onFile, onAnalyze }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useAnimationControls();

  const accept = (f: File | undefined) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const msg = !isPdf ? t.errors.not_pdf : f.size > MAX_BYTES ? t.errors.too_large : null;
    if (msg) {
      setError(msg);
      shake.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.45 } });
      return;
    }
    setError(null);
    onFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) accept(e.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <motion.div
        animate={shake}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && !file && input.current?.click()}
        whileHover={!file && !busy ? { y: -3 } : undefined}
        className={`relative overflow-hidden rounded-3xl border-2 p-6 transition-shadow sm:p-10 ${
          dragging
            ? "gradient-ring border-transparent shadow-2xl shadow-indigo-500/20"
            : error
              ? "border-rose-300 bg-rose-50/60"
              : "border-dashed border-slate-300 bg-white/80 shadow-sm hover:shadow-xl hover:shadow-indigo-500/10"
        } ${!file && !busy ? "cursor-pointer" : ""}`}
      >
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex flex-col items-center text-center"
            >
              <motion.div
                animate={dragging ? { y: -8, scale: 1.1 } : { y: [0, -6, 0] }}
                transition={dragging ? { type: "spring" } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="mb-5 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-xl shadow-indigo-500/30"
              >
                <UploadCloud className="size-8" />
              </motion.div>
              <p className="text-lg font-semibold text-slate-900">{dragging ? t.dropActive : t.dropTitle}</p>
              <p className="mt-1 text-slate-500">
                {t.dropOr}{" "}
                <span className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-4">
                  {t.dropBrowse}
                </span>
              </p>
              <p className="mt-4 text-xs text-slate-400">{t.dropHint}</p>
            </motion.div>
          ) : (
            <motion.div
              key="file"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="flex flex-col gap-5 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 text-white shadow-lg shadow-rose-500/25">
                  <FileText className="size-7" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{file.name}</p>
                  <p className="text-sm text-slate-500">{(file.size / 1024).toFixed(0)} Ko · PDF</p>
                </div>
                {!busy && (
                  <motion.button
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFile(null);
                    }}
                    aria-label={t.change}
                    className="ml-auto grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                  >
                    <X className="size-4" />
                  </motion.button>
                )}
              </div>

              <motion.button
                whileHover={!busy ? { scale: 1.03, y: -1 } : undefined}
                whileTap={!busy ? { scale: 0.97 } : undefined}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onAnalyze();
                }}
                className="relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 bg-[length:200%_100%] px-6 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/30 transition-[background-position] duration-500 hover:bg-right disabled:cursor-wait disabled:opacity-80"
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
                {busy ? t.analyzing : t.analyze}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            className="mt-3 px-2 text-sm font-medium text-rose-600"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
