"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AppFrame } from "@/components/AppFrame";
import { useAuth } from "@/components/AuthProvider";
import { FormError, PasswordField, SubmitButton } from "@/components/FormField";
import { apiFetch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

export function PasswordForm() {
  const { t } = useI18n();
  const user = useAuth();
  const forced = user.mustChangePassword;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirmation) return setError(t.auth.errors.mismatch);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(t.auth.errors[body.code] ?? t.auth.errors.generic);
        setBusy(false);
        return;
      }
      setSaved(true);
      setTimeout(() => window.location.assign("/"), 1100);
    } catch {
      setError(t.auth.errors.network);
      setBusy(false);
    }
  };

  return (
    <AppFrame>
      <main className="mx-auto max-w-md px-4 py-12 sm:py-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl shadow-indigo-900/5 backdrop-blur sm:p-8"
        >
          {saved ? (
            <div role="status" className="py-8 text-center">
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-500/30"
              >
                <CheckCircle2 className="size-8" />
              </motion.div>
              <p className="font-semibold text-slate-900">{t.auth.passwordSaved}</p>
            </div>
          ) : (
            <>
              {!forced && (
                <Link
                  href="/"
                  className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  <ArrowLeft className="size-4" />
                  {t.auth.backHome}
                </Link>
              )}
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t.auth.passwordTitle}</h1>
              <p className="mb-6 mt-1.5 text-sm text-slate-500">
                {forced ? t.auth.passwordForcedSub : t.auth.passwordSub}
              </p>
              <form onSubmit={submit} className="space-y-4">
                <PasswordField
                  label={forced ? t.auth.temporaryPassword : t.auth.currentPassword}
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
                <PasswordField
                  label={t.auth.newPassword}
                  hint={t.auth.passwordHint}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
                <PasswordField
                  label={t.auth.confirmPassword}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <FormError message={error} />
                <SubmitButton
                  busy={busy}
                  label={t.auth.passwordSave}
                  busyLabel={t.auth.passwordSaving}
                  icon={<KeyRound className="size-4" />}
                />
              </form>
            </>
          )}
        </motion.div>
      </main>
    </AppFrame>
  );
}
