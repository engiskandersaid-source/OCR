"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15";

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input id={id} className={inputClass} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-400">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className={`${inputClass} pr-11`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t.auth.hidePassword : t.auth.showPassword}
          aria-pressed={visible}
          className="absolute inset-y-0 right-1 my-auto grid size-9 place-items-center rounded-lg text-slate-400 hover:text-slate-700"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-400">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          role="alert"
          initial={{ opacity: 0, x: 0 }}
          animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-medium text-rose-700"
        >
          <AlertOctagon className="mt-0.5 size-4 shrink-0" />
          <p>{message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SubmitButton({ busy, label, busyLabel, icon }: { busy: boolean; label: string; busyLabel: string; icon?: ReactNode }) {
  return (
    <motion.button
      type="submit"
      disabled={busy}
      whileHover={busy ? undefined : { scale: 1.02, y: -1 }}
      whileTap={busy ? undefined : { scale: 0.98 }}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 disabled:opacity-70"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {busy ? busyLabel : label}
    </motion.button>
  );
}
