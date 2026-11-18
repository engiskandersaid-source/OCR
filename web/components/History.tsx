"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, Inbox, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDialog } from "@/components/Dialog";
import { formatAmount, formatDate, useI18n } from "@/lib/i18n";
import type { HistoryItem } from "@/lib/types";

function toCsv(items: HistoryItem[], withOwner: boolean) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Prevent CSV/formula injection in Excel, including behind leading whitespace.
    const safe = /^[\s=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ["file", "sender", "amount", "currency", "date", "needs_review", ...(withOwner ? ["uploaded_by"] : [])];
  const rows = items.map((i) =>
    [
      i.fileName,
      i.result.sender,
      i.result.amount,
      i.result.currency,
      i.result.date,
      i.result.needs_review,
      ...(withOwner ? [i.owner] : []),
    ]
      .map(esc)
      .join(";"),
  );
  return "﻿" + [head.join(";"), ...rows].join("\r\n");
}

export function History({ items, onClear }: { items: HistoryItem[]; onClear: () => void }) {
  const { t, locale } = useI18n();
  const isAdmin = useAuth().role === "admin";
  const [confirmingClear, setConfirmingClear] = useState(false);

  const exportCsv = () => {
    const blob = new Blob([toCsv(items, isAdmin)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `virements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur sm:p-7"
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t.history}</h2>
          <p className="text-sm text-slate-500">{isAdmin ? t.historySubAll : t.historySubOwn}</p>
        </div>
        {items.length > 0 && (
          <div className="flex gap-2">
            {isAdmin && (
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setConfirmingClear(true)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                <Trash2 className="size-4" />
                {t.clear}
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/25"
            >
              <Download className="size-4" />
              {t.exportCsv}
            </motion.button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400"
          >
            <Inbox className="size-7" />
          </motion.div>
          <p className="font-medium text-slate-700">{t.emptyTitle}</p>
          <p className="mt-1 max-w-xs text-sm text-slate-400">{t.emptySub}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-100 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{t.file}</th>
                  <th className="px-4 py-3 font-medium">{t.sender}</th>
                  <th className="px-4 py-3 text-right font-medium">{t.amount}</th>
                  <th className="px-4 py-3 font-medium">{t.date}</th>
                  {isAdmin && <th className="px-4 py-3 font-medium">{t.uploadedBy}</th>}
                  <th className="px-4 py-3 font-medium">{t.status}</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {items.map((i) => (
                    <motion.tr
                      key={i.id}
                      layout
                      initial={{ opacity: 0, backgroundColor: "rgb(238 242 255)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(255,255,255,0)" }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8 }}
                      className="border-t border-slate-100 hover:bg-slate-50/80"
                    >
                      <td className="max-w-[12rem] truncate px-4 py-3 text-slate-500">{i.fileName}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{i.result.sender ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {i.result.amount !== null ? formatAmount(i.result.amount, i.result.currency, locale) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{i.result.date ? formatDate(i.result.date, locale) : "—"}</td>
                      {isAdmin && (
                        <td className={`px-4 py-3 ${i.owner ? "text-slate-600" : "italic text-slate-400"}`}>
                          {i.owner ?? t.unassigned}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <StatusPill ok={!i.result.needs_review} />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            className="space-y-3 md:hidden"
          >
            {items.map((i) => (
              <motion.li
                key={i.id}
                layout
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className="rounded-2xl border border-slate-100 bg-white p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-slate-400">{i.fileName}</p>
                  <StatusPill ok={!i.result.needs_review} />
                </div>
                <p className="font-semibold text-slate-900">{i.result.sender ?? "—"}</p>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-500">{i.result.date ? formatDate(i.result.date, locale) : "—"}</span>
                  <span className="font-semibold tabular-nums">
                    {i.result.amount !== null ? formatAmount(i.result.amount, i.result.currency, locale) : "—"}
                  </span>
                </div>
                {isAdmin && (
                  <p className={`mt-2 text-xs ${i.owner ? "text-slate-500" : "italic text-slate-400"}`}>
                    {t.uploadedBy} · {i.owner ?? t.unassigned}
                  </p>
                )}
              </motion.li>
            ))}
          </motion.ul>
        </>
      )}

      <ConfirmDialog
        open={confirmingClear}
        title={t.clearTitle}
        body={t.clearBody.replace("{n}", String(items.length))}
        confirmLabel={t.clear}
        cancelLabel={t.cancel}
        onConfirm={() => {
          setConfirmingClear(false);
          onClear();
        }}
        onClose={() => setConfirmingClear(false)}
      />
    </motion.section>
  );
}

function StatusPill({ ok }: { ok: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      {ok ? t.verified : t.review}
    </span>
  );
}
