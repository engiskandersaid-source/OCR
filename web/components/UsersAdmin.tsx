"use client";

import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { Check, Copy, KeyRound, Power, ShieldCheck, UserPlus, Users, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AppFrame } from "@/components/AppFrame";
import { useAuth } from "@/components/AuthProvider";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { FormError, SubmitButton, TextField } from "@/components/FormField";
import { apiFetch } from "@/lib/api-client";
import type { ManagedUser, Role } from "@/lib/auth/types";
import { useI18n } from "@/lib/i18n";

type Confirmation = { kind: "toggle" | "reset"; user: ManagedUser } | null;
type Secret = { username: string; password: string } | null;

class ApiError extends Error {}

async function callApi<T>(url: string, init: RequestInit): Promise<T> {
  const res = await apiFetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body.code === "string" ? body.code : "generic");
  return body as T;
}

function Counter({ value }: { value: number }) {
  const count = useMotionValue(0);
  const text = useTransform(count, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(count, value, { duration: 0.8, ease: "easeOut" });
    return () => controls.stop();
  }, [count, value]);
  return <motion.span>{text}</motion.span>;
}

export function UsersAdmin({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const { t, locale } = useI18n();
  const me = useAuth();
  const [users, setUsers] = useState(initialUsers);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", role: "employee" as Role });
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [secret, setSecret] = useState<Secret>(null);
  const [copied, setCopied] = useState(false);

  const message = (e: unknown) => {
    const code = e instanceof ApiError ? e.message : "network";
    return t.users.errors[code] ?? t.users.errors.generic;
  };
  const replace = (user: ManagedUser) => setUsers((all) => all.map((u) => (u.id === user.id ? user : u)));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const made = await callApi<{ user: ManagedUser; temporaryPassword: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setUsers((all) => [...all, made.user].sort((a, b) => a.username.localeCompare(b.username)));
      setCreateOpen(false);
      setForm({ username: "", displayName: "", role: "employee" });
      setCopied(false);
      setSecret({ username: made.user.username, password: made.temporaryPassword });
    } catch (err) {
      setFormError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (user: ManagedUser, role: Role) => {
    if (user.role === role) return;
    setPageError(null);
    try {
      const { user: updated } = await callApi<{ user: ManagedUser }>(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      replace(updated);
    } catch (err) {
      setPageError(message(err));
    }
  };

  const runConfirmation = async () => {
    if (!confirmation) return;
    const { kind, user } = confirmation;
    setBusy(true);
    setPageError(null);
    try {
      if (kind === "toggle") {
        const { user: updated } = await callApi<{ user: ManagedUser }>(`/api/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: !user.isActive }),
        });
        replace(updated);
      } else {
        const { temporaryPassword } = await callApi<{ temporaryPassword: string }>(
          `/api/users/${user.id}/reset-password`,
          { method: "POST" },
        );
        replace({ ...user, mustChangePassword: true });
        setCopied(false);
        setSecret({ username: user.username, password: temporaryPassword });
      }
    } catch (err) {
      setPageError(message(err));
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopied(true);
    } catch {
      /* clipboard unavailable: the password stays selectable on screen */
    }
  };

  const fill = (text: string, user: ManagedUser) => text.replace("{name}", user.displayName);
  const dateFormat = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const stats = [
    { label: t.users.total, value: users.length, tone: "from-indigo-500 to-violet-500", Icon: Users },
    {
      label: t.users.admins,
      value: users.filter((u) => u.role === "admin" && u.isActive).length,
      tone: "from-violet-500 to-fuchsia-500",
      Icon: ShieldCheck,
    },
    {
      label: t.users.employees,
      value: users.filter((u) => u.role === "employee" && u.isActive).length,
      tone: "from-cyan-500 to-sky-500",
      Icon: UserRound,
    },
  ];

  return (
    <AppFrame>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t.users.title}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{t.users.sub}</p>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25"
          >
            <UserPlus className="size-4" />
            {t.users.add}
          </motion.button>
        </motion.div>

        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
          className="mt-8 grid gap-3 sm:grid-cols-3"
        >
          {stats.map(({ label, value, tone, Icon }) => (
            <motion.div
              key={label}
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              whileHover={{ y: -3 }}
              className="flex items-center gap-3.5 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur"
            >
              <span className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-md`}>
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-2xl font-bold tabular-nums text-slate-900">
                  <Counter value={value} />
                </p>
                <p className="text-xs font-medium text-slate-500">{label}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-6">
          <FormError message={pageError} />
        </div>

        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } }}
          className="mt-4 space-y-3"
        >
          {users.map((user) => {
            const self = user.id === me.id;
            return (
              <motion.li
                key={user.id}
                layout
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                className={`flex flex-col gap-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur transition-shadow hover:shadow-md lg:flex-row lg:items-center ${
                  user.isActive ? "" : "opacity-60"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold uppercase text-white ${
                      user.role === "admin" ? "from-violet-500 to-fuchsia-500" : "from-cyan-500 to-sky-500"
                    }`}
                  >
                    {user.displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                      <span className="truncate">{user.displayName}</span>
                      {self && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          {t.users.you}
                        </span>
                      )}
                      {!user.isActive && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {t.users.disabled}
                        </span>
                      )}
                      {user.isActive && user.mustChangePassword && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          {t.users.pendingPassword}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      @{user.username} · {t.users.lastLogin}{" "}
                      {user.lastLoginAt ? dateFormat.format(user.lastLoginAt) : t.users.never}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label={t.users.role}
                    className="flex rounded-full bg-slate-900/5 p-1 text-xs font-semibold"
                  >
                    {(["employee", "admin"] as Role[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        disabled={self || !user.isActive}
                        aria-pressed={user.role === role}
                        onClick={() => changeRole(user, role)}
                        className={`rounded-full px-3 py-1.5 transition disabled:cursor-not-allowed ${
                          user.role === role ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {t.auth.roles[role]}
                      </button>
                    ))}
                  </div>
                  {!self && (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmation({ kind: "reset", user })}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        <KeyRound className="size-3.5" />
                        {t.users.resetPassword}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmation({ kind: "toggle", user })}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${
                          user.isActive ? "text-rose-600 hover:bg-rose-50" : "text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        <Power className="size-3.5" />
                        {user.isActive ? t.users.disable : t.users.enable}
                      </button>
                    </>
                  )}
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      </main>

      <Dialog open={createOpen} title={t.users.createTitle} onClose={() => setCreateOpen(false)}>
        <form onSubmit={create} className="mt-3 space-y-4">
          <TextField
            label={t.users.displayName}
            required
            autoFocus
            maxLength={80}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <TextField
            label={t.users.username}
            hint={t.users.usernameHint}
            required
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
          />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">{t.users.role}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["employee", "admin"] as Role[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={form.role === role}
                  onClick={() => setForm({ ...form, role })}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    form.role === role
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 ring-4 ring-indigo-500/10"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {t.auth.roles[role]}
                </button>
              ))}
            </div>
          </fieldset>
          <FormError message={formError} />
          <SubmitButton
            busy={busy}
            label={t.users.create}
            busyLabel={t.users.creating}
            icon={<UserPlus className="size-4" />}
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmation !== null}
        busy={busy}
        title={
          confirmation?.kind === "reset"
            ? t.users.resetTitle
            : confirmation?.user.isActive
              ? t.users.disableTitle
              : t.users.enableTitle
        }
        body={
          confirmation
            ? fill(
                confirmation.kind === "reset"
                  ? t.users.resetBody
                  : confirmation.user.isActive
                    ? t.users.disableBody
                    : t.users.enableBody,
                confirmation.user,
              )
            : ""
        }
        confirmLabel={
          confirmation?.kind === "reset"
            ? t.users.resetPassword
            : confirmation?.user.isActive
              ? t.users.disable
              : t.users.enable
        }
        cancelLabel={t.cancel}
        onConfirm={runConfirmation}
        onClose={() => setConfirmation(null)}
      />

      {/* Not closable by clicking outside: the password cannot be shown again. */}
      <Dialog open={secret !== null} title={t.users.tempTitle} onClose={() => undefined}>
        <p className="text-sm leading-relaxed text-slate-600">
          {t.users.tempBody.replace("{username}", secret?.username ?? "")}
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-900 p-2 pl-4">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-cyan-200">{secret?.password}</code>
          <button
            type="button"
            onClick={copySecret}
            aria-label={t.users.tempCopy}
            title={t.users.tempCopy}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied ? "done" : "copy"} initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setSecret(null)}
          className="mt-5 w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
        >
          {t.users.tempDone}
        </button>
      </Dialog>
    </AppFrame>
  );
}
