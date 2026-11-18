"use client";

import { motion } from "framer-motion";
import { useI18n, type Locale } from "@/lib/i18n";

export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="relative flex rounded-full bg-slate-900/5 p-1 text-sm font-medium">
      {(["fr", "en"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className="relative z-10 rounded-full px-3 py-1 uppercase transition-colors"
          aria-pressed={locale === l}
        >
          {locale === l && (
            <motion.span
              layoutId="lang-pill"
              className="absolute inset-0 -z-10 rounded-full bg-white shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          <span className={locale === l ? "text-slate-900" : "text-slate-500"}>{l}</span>
        </button>
      ))}
    </div>
  );
}
