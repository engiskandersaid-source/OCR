"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Loader2,
  MessageCircle,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

type Role = "user" | "assistant";
type Message = { id: string; role: Role; content: string; stopped?: boolean };
type Phase = "idle" | "waiting" | "searching" | "streaming";

type ServerEvent =
  | { type: "status"; status: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: string };

const LEGACY_STORAGE_KEY = "virementocr.chat.v1";
/** Dispatched on `window` by the page whenever the stored transfers change. */
export const TRANSFERS_CHANGED_EVENT = "virementocr:transfers-changed";
const MAX_CHARS = 1000;
const COUNTER_FROM = 800;
const MAX_HISTORY = 24;
const PANEL_ID = "chat-panel";
const GRADIENT = "bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500";

let seq = 0;
const newId = () => `m${Date.now().toString(36)}-${(seq++).toString(36)}`;

/* ------------------------------------------------------------------ */
/* Safe mini-renderer: **bold**, "-" bullets and line breaks only.     */
/* Everything is rendered as React text nodes, never as HTML.          */
/* ------------------------------------------------------------------ */

function inline(raw: string, keyBase: string): ReactNode[] {
  // Keep digit groups together ("15 000" must not wrap in the middle of a number).
  const text = raw.replace(/(\d) (?=\d{3}(?!\d))/g, "$1\u00a0");
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flush = () => {
    const k = blocks.length;
    if (para.length > 0) {
      blocks.push(
        <p key={`p${k}`}>
          {para.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {inline(line, `p${k}-${i}`)}
            </span>
          ))}
        </p>,
      );
      para = [];
    }
    if (list.length > 0) {
      blocks.push(
        <ul key={`l${k}`} className="space-y-1">
          {list.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500" />
              <span className="min-w-0 flex-1">{inline(item, `l${k}-${i}`)}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (para.length > 0) flush();
      list.push(bullet[1]);
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list.length > 0) flush();
      para.push(line);
    }
  }
  flush();

  return <div className="space-y-2 [overflow-wrap:anywhere]">{blocks}</div>;
}

/* ------------------------------------------------------------------ */

function BotAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full ${GRADIENT} text-white shadow-md shadow-indigo-500/30 ${className}`}
    >
      <Bot className="size-[55%]" />
    </span>
  );
}

function TypingDots({ reduce }: { reduce: boolean }) {
  return (
    <span className="flex items-center gap-1.5 py-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500"
          animate={reduce ? { opacity: [0.35, 1, 0.35] } : { y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

export function ChatWidget() {
  const { t, locale } = useI18n();
  const c = t.chat;
  const reduce = useReducedMotion() ?? false;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);

  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickRef = useRef(true);
  const openRef = useRef(open);
  const wasOpenRef = useRef(false);

  const busy = phase !== "idle";

  /* ---------- no persistence ----------
   * The conversation lives in memory only. It used to be saved in sessionStorage and
   * restored on reload, which kept old answers (about transfers that had since been
   * cleared or replaced) on screen and resent them to the model as history.
   * A reload now always starts a clean conversation; the legacy key is purged. */
  useEffect(() => {
    try {
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* storage blocked: nothing to purge */
    }
  }, []);

  // The stored transfers changed (cleared or a new one added): earlier answers may
  // describe data that no longer exists, so the conversation starts over.
  useEffect(() => {
    const onChange = () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setMessages([]);
      setError(null);
      setPhase("idle");
    };
    window.addEventListener(TRANSFERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TRANSFERS_CHANGED_EVENT, onChange);
  }, []);

  /* ---------- responsive: full-screen sheet below `sm` ---------- */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Lock the page scroll behind the sheet, and follow the visual viewport so the
  // composer stays visible when the on-screen keyboard opens.
  useEffect(() => {
    if (!open || !isMobile) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";

    const vv = window.visualViewport;
    const sync = () => {
      if (vv) setViewport({ height: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    };
    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    return () => {
      body.style.overflow = previous;
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      setViewport(null);
    };
  }, [open, isMobile]);

  /* ---------- open / close: focus management, Escape ---------- */
  useEffect(() => {
    openRef.current = open;
    if (open) {
      wasOpenRef.current = true;
      setUnread(false);
      stickRef.current = true;
      const id = window.setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
        const el = scrollRef.current;
        if (el) el.scrollTop = el.querySelector("[role=log]") ? el.scrollHeight : 0;
      }, 60);
      return () => window.clearTimeout(id);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      fabRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Cancel any in-flight request when the widget unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------- auto-scroll (only while the user is at the bottom) ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length === 0 && phase === "idle") el.scrollTop = 0; // empty state reads from the top
    else if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, phase, error, viewport]);

  // The list also shrinks when the error banner, the keyboard or a taller composer appears.
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current && el.querySelector("[role=log]")) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  /* ---------- auto-growing textarea (1 to 4 lines) ---------- */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
    el.style.overflowY = el.scrollHeight > 112 ? "auto" : "hidden";
  }, [input, open]);

  /* ---------- conversation ---------- */
  const run = async (history: Message[]) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setPhase("waiting");
    stickRef.current = true;

    const replyId = newId();
    let started = false;
    const append = (text: string) => {
      if (!text) return;
      if (!started) {
        started = true;
        setMessages((prev) => [...prev, { id: replyId, role: "assistant", content: text }]);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: m.content + text } : m)));
      }
      setPhase("streaming");
    };
    const fail = (code: string) => {
      setError(code);
      setPhase("idle");
    };

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          locale,
          messages: history
            .filter((m) => m.content.trim().length > 0)
            .slice(-MAX_HISTORY)
            .map((m) => ({
              role: m.role,
              content: m.content.length > MAX_CHARS ? `${m.content.slice(0, MAX_CHARS - 1)}…` : m.content,
            })),
        }),
      });

      if (!res.ok || !res.body) {
        const j: unknown = await res.json().catch(() => null);
        const code = j && typeof j === "object" && typeof (j as { code?: unknown }).code === "string" ? (j as { code: string }).code : "generic";
        return fail(code);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          let ev: ServerEvent;
          try {
            ev = JSON.parse(raw) as ServerEvent;
          } catch {
            continue;
          }
          if (ev.type === "delta") append(ev.text);
          else if (ev.type === "status") setPhase("searching");
          else if (ev.type === "error") return fail(ev.code);
          else if (ev.type === "done") finished = true;
        }
      }

      if (!finished && !started) return fail("network");
      setPhase("idle");
      if (!openRef.current) setUnread(true);
    } catch {
      if (ctrl.signal.aborted) {
        // Stopped by the user: keep what was already written and flag it.
        if (abortRef.current === ctrl) {
          if (started) setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, stopped: true } : m)));
          setPhase("idle");
        }
        return;
      }
      fail("network");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const send = (text: string) => {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || busy) return;
    const next: Message[] = [...messages, { id: newId(), role: "user", content }];
    setMessages(next);
    setInput("");
    void run(next);
  };

  const retry = () => {
    if (busy) return;
    // Resend up to the last user message; a partial reply after it is dropped.
    let last = -1;
    messages.forEach((m, i) => {
      if (m.role === "user") last = i;
    });
    if (last < 0) return setError(null);
    const history = messages.slice(0, last + 1);
    setMessages(history);
    void run(history);
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setPhase("idle");
    setInput("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const spring = reduce ? { duration: 0.15 } : ({ type: "spring", stiffness: 380, damping: 30, mass: 0.9 } as const);
  const last = messages[messages.length - 1];
  const showTyping = phase === "waiting" || (phase === "searching" && last?.role !== "assistant");
  const showSearching = phase === "searching";
  const canSend = input.trim().length > 0 && !busy;

  const mobileStyle =
    isMobile && viewport ? { height: viewport.height, top: viewport.top, bottom: "auto" as const } : undefined;

  return (
    <>
      {/* ---------------- Panel ---------------- */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            id={PANEL_ID}
            role="dialog"
            aria-label={c.dialogLabel}
            aria-modal={isMobile || undefined}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 28 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 20, transition: { duration: 0.18, ease: "easeIn" } }}
            transition={spring}
            style={{ transformOrigin: "bottom right", ...mobileStyle }}
            className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col overflow-hidden bg-white/95 shadow-2xl shadow-indigo-950/20 backdrop-blur-xl sm:inset-x-auto sm:top-auto sm:bottom-[calc(5.75rem+env(safe-area-inset-bottom))] sm:right-[calc(1.5rem+env(safe-area-inset-right))] sm:h-[min(640px,calc(100dvh-7.5rem-env(safe-area-inset-bottom)))] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:bg-white/85 sm:ring-1 sm:ring-slate-900/10"
          >
            {/* Header */}
            <header
              className={`relative flex shrink-0 items-center gap-3 overflow-hidden bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-600 pb-3 pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] text-white`}
            >
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-16 size-40 rounded-full bg-white/20 blur-2xl"
                animate={reduce ? undefined : { x: [0, -24, 0], y: [0, 10, 0] }}
                transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.span
                aria-hidden
                initial={reduce ? false : { scale: 0, rotate: -60 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.08 }}
                className="relative grid size-10 shrink-0 place-items-center rounded-2xl bg-white/20 max-[359px]:hidden ring-1 ring-white/30 backdrop-blur"
              >
                <Bot className="size-5" />
                <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-400 ring-2 ring-violet-600" />
              </motion.span>
              <div className="relative min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight">{c.title}</h2>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/90">{c.subtitle}</p>
              </div>
              <div className="relative flex shrink-0 items-center gap-1">
                <motion.button
                  type="button"
                  whileHover={reduce ? undefined : { scale: 1.08, rotate: -6 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={reset}
                  disabled={messages.length === 0 && !busy && !error}
                  aria-label={c.newChat}
                  title={c.newChat}
                  className="grid size-11 place-items-center rounded-xl bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
                >
                  <SquarePen className="size-[18px]" />
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={reduce ? undefined : { scale: 1.08, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setOpen(false)}
                  aria-label={c.close}
                  title={c.close}
                  className="grid size-11 place-items-center rounded-xl bg-white/15 outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X className="size-5" />
                </motion.button>
              </div>
            </header>

            {/* Messages */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-indigo-50/60 via-white/40 to-white/0 px-[calc(1rem+env(safe-area-inset-left))] py-4"
            >
              {messages.length === 0 && !busy ? (
                <div className="flex min-h-full flex-col items-center justify-center py-2 text-center">
                  <motion.div
                    animate={reduce ? undefined : { y: [0, -7, 0], rotate: [0, -3, 0, 3, 0] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                    className="relative mb-4"
                  >
                    <span aria-hidden className={`absolute inset-0 rounded-3xl ${GRADIENT} opacity-40 blur-xl`} />
                    <span className={`relative grid size-16 place-items-center rounded-3xl ${GRADIENT} text-white shadow-lg shadow-indigo-500/30`}>
                      <Sparkles className="size-8" aria-hidden />
                    </span>
                  </motion.div>
                  <motion.p
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-base font-semibold tracking-tight text-slate-900"
                  >
                    {c.emptyTitle}
                  </motion.p>
                  <motion.p
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.16 }}
                    className="mt-1 max-w-[19rem] text-sm text-slate-600"
                  >
                    {c.emptySub}
                  </motion.p>
                  <motion.ul
                    aria-label={c.suggestionsLabel}
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.22 } } }}
                    className="mt-5 flex w-full flex-col gap-2"
                  >
                    {c.suggestions.map((s) => (
                      <motion.li key={s} variants={{ hidden: { opacity: 0, y: reduce ? 0 : 12 }, show: { opacity: 1, y: 0 } }}>
                        <motion.button
                          type="button"
                          whileHover={reduce ? undefined : { y: -2, scale: 1.015 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => send(s)}
                          className="group flex min-h-11 w-full items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition-[box-shadow,border-color,color] hover:border-indigo-200 hover:text-indigo-700 hover:shadow-md hover:shadow-indigo-500/10 focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-50 to-cyan-50 text-indigo-600 transition-colors group-hover:from-indigo-100 group-hover:to-cyan-100">
                            <Sparkles className="size-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">{s}</span>
                          <ArrowUp className="size-4 shrink-0 rotate-45 text-slate-300 transition-colors group-hover:text-indigo-500" aria-hidden />
                        </motion.button>
                      </motion.li>
                    ))}
                  </motion.ul>
                </div>
              ) : (
                <div role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="space-y-3">
                  <AnimatePresence initial={false}>
                    {messages.map((m) =>
                      m.role === "user" ? (
                        <motion.div
                          key={m.id}
                          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={spring}
                          style={{ transformOrigin: "bottom right" }}
                          className="flex justify-end"
                        >
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-md shadow-indigo-500/25 [overflow-wrap:anywhere]">
                            <span className="sr-only">{c.you} : </span>
                            {m.content}
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={m.id}
                          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={spring}
                          style={{ transformOrigin: "bottom left" }}
                          className="flex items-end gap-2"
                        >
                          <BotAvatar className="size-7" />
                          <div className="min-w-0 max-w-[85%]">
                            <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200/70">
                              <span className="sr-only">{c.assistant} : </span>
                              <RichText text={m.content} />
                              {phase === "streaming" && m.id === last?.id && (
                                <motion.span
                                  aria-hidden
                                  className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 rounded-full bg-indigo-500"
                                  animate={{ opacity: [1, 0.15, 1] }}
                                  transition={{ duration: 0.9, repeat: Infinity }}
                                />
                              )}
                            </div>
                            {m.stopped && <p className="mt-1 pl-1 text-xs text-slate-500">{c.stopped}</p>}
                          </div>
                        </motion.div>
                      ),
                    )}

                    {showTyping && (
                      <motion.div
                        key="typing"
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.1 } }}
                        style={{ transformOrigin: "bottom left" }}
                        className="flex items-end gap-2"
                      >
                        <BotAvatar className="size-7" />
                        <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-slate-200/70">
                          <span className="sr-only">{c.typing}</span>
                          <TypingDots reduce={reduce} />
                        </div>
                      </motion.div>
                    )}

                    {showSearching && (
                      <motion.div
                        key="searching"
                        initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.1 } }}
                        className="flex items-center gap-2 pl-9 text-xs font-medium text-indigo-700"
                      >
                        <motion.span
                          aria-hidden
                          animate={reduce ? undefined : { rotate: [0, 14, -10, 0], scale: [1, 1.12, 1] }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                          className="grid size-5 place-items-center rounded-full bg-indigo-100"
                        >
                          <Search className="size-3" />
                        </motion.span>
                        <motion.span
                          animate={{ opacity: [0.55, 1, 0.55] }}
                          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                        >
                          {c.searching}
                        </motion.span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  key={error}
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto", x: reduce ? 0 : [0, -7, 7, -4, 4, 0] }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.4 }}
                  className="shrink-0 overflow-hidden px-[calc(0.75rem+env(safe-area-inset-left))]"
                >
                  <div className="mb-2 flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-800">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{c.errors[error] ?? c.errors.generic}</p>
                    <motion.button
                      type="button"
                      whileHover={reduce ? undefined : { scale: 1.05 }}
                      whileTap={{ scale: 0.94 }}
                      onClick={retry}
                      className="-my-1.5 -mr-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold text-rose-800 outline-none hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      {c.retry}
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="shrink-0 border-t border-slate-200/70 bg-white/80 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] pt-2.5 backdrop-blur"
            >
              <div className="flex items-end gap-2 rounded-2xl bg-slate-100/80 p-1.5 ring-1 ring-slate-200/80 transition-shadow focus-within:bg-white focus-within:shadow-lg focus-within:shadow-indigo-500/10 focus-within:ring-2 focus-within:ring-indigo-500">
                <label htmlFor="chat-input" className="sr-only">
                  {c.inputLabel}
                </label>
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  rows={1}
                  value={input}
                  maxLength={MAX_CHARS}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={c.placeholder}
                  enterKeyHint="send"
                  aria-describedby="chat-hint"
                  className="max-h-28 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-500 sm:text-sm"
                />
                <AnimatePresence initial={false}>
                  {busy && (
                    <motion.button
                      key="stop"
                      type="button"
                      initial={{ opacity: 0, scale: 0.6, width: 0 }}
                      animate={{ opacity: 1, scale: 1, width: 44 }}
                      exit={{ opacity: 0, scale: 0.6, width: 0 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={stop}
                      aria-label={c.stop}
                      title={c.stop}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-900 text-white shadow-md outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    >
                      <Square className="size-3.5 fill-current" aria-hidden />
                    </motion.button>
                  )}
                </AnimatePresence>
                <motion.button
                  type="submit"
                  whileHover={canSend && !reduce ? { scale: 1.06, y: -1 } : undefined}
                  whileTap={canSend ? { scale: 0.92 } : undefined}
                  disabled={!canSend}
                  aria-label={c.send}
                  title={c.send}
                  className={`grid size-11 shrink-0 place-items-center rounded-xl text-white outline-none transition-[opacity,box-shadow,filter] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${GRADIENT} ${
                    canSend ? "shadow-lg shadow-indigo-500/35" : "opacity-45 saturate-50"
                  }`}
                >
                  {busy ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
                </motion.button>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[11px] leading-4 text-slate-500">
                <p id="chat-hint" className="hidden truncate sm:block">
                  {c.hint}
                </p>
                <AnimatePresence>
                  {input.length >= COUNTER_FROM && (
                    <motion.span
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      aria-live="polite"
                      className={`ml-auto shrink-0 font-medium tabular-nums ${input.length >= MAX_CHARS ? "text-rose-600" : "text-slate-500"}`}
                    >
                      {input.length} / {MAX_CHARS}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Floating button ---------------- */}
      <div
        className={`fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-50 sm:right-[calc(1.5rem+env(safe-area-inset-right))] ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {!open && !reduce && (
          <>
            <motion.span
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full ${GRADIENT}`}
              animate={{ scale: [1, 1.55], opacity: [0.45, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.span
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full ${GRADIENT}`}
              animate={{ scale: [1, 1.55], opacity: [0.3, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 1.1 }}
            />
          </>
        )}
        <motion.button
          ref={fabRef}
          type="button"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0, rotate: -90 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={reduce ? { duration: 0.2 } : { type: "spring", stiffness: 260, damping: 18, delay: 0.5 }}
          whileHover={reduce ? undefined : { scale: 1.08, y: -3 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? c.close : c.open}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-haspopup="dialog"
          title={open ? c.close : c.open}
          className={`relative grid size-14 place-items-center rounded-full text-white shadow-xl shadow-indigo-600/40 outline-none ring-1 ring-white/30 focus-visible:ring-4 focus-visible:ring-indigo-300 sm:size-[3.75rem] ${GRADIENT}`}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? "close" : "chat"}
              initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: open ? -90 : 90, scale: 0.4 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, rotate: open ? 90 : -90, scale: 0.4 }}
              transition={{ duration: 0.18 }}
              className="relative grid place-items-center"
            >
              {open ? <X className="size-6" aria-hidden /> : <MessageCircle className="size-6" aria-hidden />}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence>
            {unread && !open && (
              <motion.span
                key="unread"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
                className="absolute right-0.5 top-0.5 size-3.5 rounded-full bg-rose-500 ring-2 ring-white"
              >
                <span className="sr-only">{c.assistant}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </>
  );
}
