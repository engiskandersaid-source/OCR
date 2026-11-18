"use client";

import { motion } from "framer-motion";
import { KeyRound, Loader2, LogOut, ScanText, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n } from "@/lib/i18n";

const iconButton =
  "grid size-9 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900";

export function Header() {
  const { t } = useI18n();
  const user = useAuth();
  const [leaving, setLeaving] = useState(false);
  const isAdmin = user.role === "admin";

  const signOut = async () => {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    // A full reload clears the history and chat held in memory on shared computers.
    window.location.assign("/login");
  };

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="sticky top-0 z-40 border-b border-white/40 bg-white/60 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <motion.div
            whileHover={{ rotate: -8, scale: 1.08 }}
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 text-white shadow-lg shadow-indigo-500/30"
          >
            <ScanText className="size-5" />
          </motion.div>
          <span className="hidden text-lg font-semibold tracking-tight sm:inline">{t.brand}</span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <div className="mr-1 hidden text-right leading-tight md:block">
            <p className="max-w-40 truncate text-sm font-semibold text-slate-800">{user.displayName}</p>
            <p
              className={`inline-flex items-center gap-1 text-xs font-medium ${isAdmin ? "text-violet-600" : "text-slate-500"}`}
            >
              {isAdmin && <ShieldCheck className="size-3" />}
              {t.auth.roles[user.role]}
            </p>
          </div>

          {isAdmin && (
            <Link href="/admin/users" className={iconButton} aria-label={t.users.title} title={t.users.title}>
              <Users className="size-[18px]" />
            </Link>
          )}
          <Link
            href="/account/password"
            className={iconButton}
            aria-label={t.auth.changePassword}
            title={t.auth.changePassword}
          >
            <KeyRound className="size-[18px]" />
          </Link>
          <button
            type="button"
            onClick={signOut}
            disabled={leaving}
            className={iconButton}
            aria-label={t.auth.signOut}
            title={t.auth.signOut}
          >
            {leaving ? <Loader2 className="size-[18px] animate-spin" /> : <LogOut className="size-[18px]" />}
          </button>
          <LanguageSwitch />
        </div>
      </div>
    </motion.header>
  );
}
