"use client";

import { motion } from "framer-motion";
import { LogIn, ScanText, Terminal } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Backdrop } from "@/components/Backdrop";
import { FormError, PasswordField, SubmitButton, TextField } from "@/components/FormField";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/lib/i18n";

export function LoginForm({ hasAdmin }: { hasAdmin: boolean }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPassword("");
        setError(t.auth.errors[body.code] ?? t.auth.errors.generic);
        setBusy(false);
        return;
      }
      window.location.assign(body.mustChangePassword ? "/account/password" : "/");
    } catch {
      setError(t.auth.errors.network);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <Backdrop />
      <div className="flex justify-end p-4 sm:p-6">
        <LanguageSwitch />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="mb-7 text-center">
            <motion.div
              initial={{ scale: 0.7, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
              className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 text-white shadow-xl shadow-indigo-500/30"
            >
              <ScanText className="size-7" />
            </motion.div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t.brand}</h1>
            <p className="mt-2 text-sm text-slate-500">{t.auth.signInSub}</p>
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl shadow-indigo-900/5 backdrop-blur sm:p-8">
            {hasAdmin ? (
              <form onSubmit={submit} className="space-y-4">
                <TextField
                  label={t.auth.username}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <PasswordField
                  label={t.auth.password}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FormError message={error} />
                <SubmitButton
                  busy={busy}
                  label={t.auth.signIn}
                  busyLabel={t.auth.signingIn}
                  icon={<LogIn className="size-4" />}
                />
              </form>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-2.5 font-semibold text-slate-900">
                  <span className="grid size-9 place-items-center rounded-xl bg-amber-100 text-amber-700">
                    <Terminal className="size-[18px]" />
                  </span>
                  {t.auth.noAdminTitle}
                </div>
                <p className="text-sm leading-relaxed text-slate-600">{t.auth.noAdminBody}</p>
                <code className="mt-4 block overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-cyan-200">
                  npm run create-admin -- admin
                </code>
              </div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
