"use client";

import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { AlertTriangle, Banknote, CalendarDays, Check, ChevronDown, Copy, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAmount, formatDate, useI18n } from "@/lib/i18n";
import type { ExtractResult, OcrLine } from "@/lib/types";

function AnimatedAmount({ value, currency }: { value: number; currency: string | null }) {
  const { locale } = useI18n();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => formatAmount(v, currency, locale));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function ResultCard({ result, ocr, fileName }: { result: ExtractResult; ocr: OcrLine[]; fileName: string }) {
  const { t, locale } = useI18n();
  const [showOcr, setShowOcr] = useState(false);
  const [copied, setCopied] = useState(false);

  const ok = !result.needs_review;

  const fields = [
    {
      key: "sender",
      label: t.sender,
      icon: UserRound,
      color: "from-indigo-500 to-violet-500",
      value: result.sender,
      render: () => result.sender,
    },
    {
      key: "amount",
      label: t.amount,
      icon: Banknote,
      color: "from-emerald-500 to-teal-500",
      value: result.amount,
      render: () => <AnimatedAmount value={result.amount!} currency={result.currency} />,
    },
    {
      key: "date",
      label: t.date,
      icon: CalendarDays,
      color: "from-amber-500 to-orange-500",
      value: result.date,
      render: () => formatDate(result.date!, locale),
    },
  ];

  const copy = async () => {
    const { sender, amount, currency, date } = result;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ sender, amount, currency, date }, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
      className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-xl shadow-slate-900/5"
    >
      {/* Header band */}
      <div
        className={`relative flex flex-wrap items-center gap-3 px-5 py-4 text-white sm:px-7 ${
          ok ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" : "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500"
        }`}
      >
        <motion.div
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
          className="grid size-10 place-items-center rounded-full bg-white/25 backdrop-blur"
        >
          {ok ? (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={3}>
              <motion.path
                d="M5 12.5l4.5 4.5L19 7.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.35 }}
              />
            </svg>
          ) : (
            <AlertTriangle className="size-5" />
          )}
        </motion.div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t.resultTitle}</h2>
          <p className="truncate text-sm text-white/80">{fileName}</p>
        </div>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur">
          {ok ? t.verified : t.review}
        </span>
      </div>

      {!result.is_bank_transfer ? (
        <div className="flex items-center gap-3 p-7 text-amber-700">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="font-medium">{t.notTransfer}</p>
        </div>
      ) : (
        <>
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } }}
            className="grid gap-4 p-5 sm:grid-cols-3 sm:p-7"
          >
            {fields.map((f) => (
              <motion.div
                key={f.key}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                whileHover={{ y: -4 }}
                className="group rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-5 transition-shadow hover:shadow-lg hover:shadow-slate-900/5 hover:ring-1 hover:ring-slate-200"
              >
                <div className={`mb-4 grid size-10 place-items-center rounded-xl bg-gradient-to-br ${f.color} text-white shadow-md`}>
                  <f.icon className="size-5" />
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{f.label}</p>
                <p className={`mt-1 break-words text-xl font-semibold tabular-nums ${f.value === null ? "text-slate-300" : "text-slate-900"}`}>
                  {f.value === null ? t.notFound : f.render()}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {result.warnings.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mx-5 mb-5 space-y-1 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 sm:mx-7"
            >
              {result.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t.warnings[w] ?? w}
                </li>
              ))}
            </motion.ul>
          )}
        </>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-4 sm:px-7">
        <p className="flex flex-1 items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
          {t.scopeNote}
        </p>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setShowOcr((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
        >
          {t.ocrText} · {ocr.length} {t.lines}
          <motion.span animate={{ rotate: showOcr ? 180 : 0 }}>
            <ChevronDown className="size-4" />
          </motion.span>
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-md hover:bg-slate-800"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? "ok" : "copy"}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
            </motion.span>
          </AnimatePresence>
          {copied ? t.copied : t.copy}
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {showOcr && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <ol className="max-h-80 overflow-auto bg-slate-950 px-5 py-4 font-mono text-xs leading-relaxed text-slate-300 sm:px-7">
              {ocr.map((l, i) => (
                <li key={i} className="flex gap-4">
                  <span className="w-6 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
                  <span className="flex-1 break-words">{l.text}</span>
                  <span className={`shrink-0 ${l.score > 0.9 ? "text-emerald-500" : "text-amber-500"}`}>
                    {(l.score * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
