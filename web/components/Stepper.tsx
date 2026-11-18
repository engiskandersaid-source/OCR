"use client";

import { motion } from "framer-motion";
import { Brain, Check, CheckCircle2, ScanLine, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type Stage = "idle" | "upload" | "ocr" | "llm" | "done" | "error";

const ORDER: Stage[] = ["upload", "ocr", "llm", "done"];

export function Stepper({ stage, failedAt }: { stage: Stage; failedAt: Stage | null }) {
  const { t } = useI18n();
  const steps = [
    { key: "upload", icon: Upload, label: t.stepUpload, desc: t.stepUploadDesc, color: "from-sky-500 to-indigo-500" },
    { key: "ocr", icon: ScanLine, label: t.stepOcr, desc: t.stepOcrDesc, color: "from-amber-500 to-orange-500" },
    { key: "llm", icon: Brain, label: t.stepLlm, desc: t.stepLlmDesc, color: "from-violet-500 to-fuchsia-500" },
    { key: "done", icon: CheckCircle2, label: t.stepDone, desc: t.stepDoneDesc, color: "from-emerald-500 to-teal-500" },
  ] as const;

  const current = stage === "error" ? ORDER.indexOf(failedAt ?? "upload") : ORDER.indexOf(stage);

  return (
    <motion.ol
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.1 } } }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {steps.map((s, i) => {
        const done = i < current || stage === "done";
        const active = i === current && stage !== "done" && stage !== "error";
        const failed = stage === "error" && i === current;
        const Icon = failed ? X : done ? Check : s.icon;

        return (
          <motion.li
            key={s.key}
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className={`relative overflow-hidden rounded-2xl border bg-white/80 p-4 backdrop-blur transition-all duration-500 ${
              active
                ? "border-indigo-200 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/20"
                : failed
                  ? "border-rose-200 ring-2 ring-rose-500/20"
                  : "border-slate-200/70"
            }`}
          >
            {active && (
              <motion.div
                className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-500 to-transparent"
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <div className="flex items-center gap-3">
              <motion.div
                animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={active ? { duration: 1.2, repeat: Infinity } : undefined}
                className={`grid size-9 shrink-0 place-items-center rounded-xl text-white shadow-md ${
                  failed
                    ? "bg-rose-500"
                    : done || active
                      ? `bg-gradient-to-br ${s.color}`
                      : "bg-slate-200 text-slate-500 shadow-none"
                }`}
              >
                <Icon className="size-4.5" />
              </motion.div>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${done || active ? "text-slate-900" : "text-slate-500"}`}>
                  {s.label}
                </p>
                <p className="truncate text-xs text-slate-400">{s.desc}</p>
              </div>
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
