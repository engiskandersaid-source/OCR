import type { HistoryItem } from "./types";

/**
 * Retrieval for the chat assistant. Pure functions over the stored transfers so that
 * counts, sums and extremes are computed in code (exact), never estimated by the model.
 * No I/O here, which also keeps it easy to test.
 */

export type SearchInput = {
  sender_contains: string | null;
  date_from: string | null;
  date_to: string | null;
  amount_min: number | null;
  amount_max: number | null;
  currency: string | null;
  needs_review: boolean | null;
  limit: number | null;
};

export const SEARCH_KEYS = [
  "sender_contains",
  "date_from",
  "date_to",
  "amount_min",
  "amount_max",
  "currency",
  "needs_review",
  "limit",
] as const satisfies readonly (keyof SearchInput)[];

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
const UNKNOWN_CURRENCY = "UNKNOWN";

export type Validation = { ok: true; value: SearchInput } | { ok: false; error: string };

function isIsoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validates the model-supplied tool arguments (types and ranges) before anything runs. */
export function validateSearchInput(raw: unknown): Validation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Arguments must be a JSON object." };
  }
  const o = raw as Record<string, unknown>;
  const known: readonly string[] = SEARCH_KEYS;
  const extra = Object.keys(o).filter((k) => !known.includes(k));
  if (extra.length > 0) return { ok: false, error: `Unknown argument(s): ${extra.join(", ").slice(0, 120)}.` };

  const str = (k: string, max: number): string | null | Error => {
    const v = o[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") return new Error(`${k} must be a string or null.`);
    const s = v.trim();
    if (s.length > max) return new Error(`${k} is too long (max ${max} characters).`);
    return s === "" ? null : s;
  };
  const num = (k: string): number | null | Error => {
    const v = o[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) return new Error(`${k} must be a finite number or null.`);
    if (v < 0) return new Error(`${k} must be >= 0.`);
    return v;
  };
  const date = (k: string): string | null | Error => {
    const v = str(k, 10);
    if (v === null || v instanceof Error) return v;
    return isIsoDate(v) ? v : new Error(`${k} must be a real calendar date in YYYY-MM-DD format.`);
  };

  const sender_contains = str("sender_contains", 120);
  const date_from = date("date_from");
  const date_to = date("date_to");
  const amount_min = num("amount_min");
  const amount_max = num("amount_max");
  const currency = str("currency", 10);
  const limitRaw = num("limit");

  for (const v of [sender_contains, date_from, date_to, amount_min, amount_max, currency, limitRaw]) {
    if (v instanceof Error) return { ok: false, error: v.message };
  }

  const nr = o.needs_review;
  if (nr !== null && nr !== undefined && typeof nr !== "boolean") {
    return { ok: false, error: "needs_review must be true, false or null." };
  }

  let limit = limitRaw as number | null;
  if (limit !== null) {
    if (!Number.isInteger(limit) || limit < 1) return { ok: false, error: "limit must be an integer >= 1." };
    limit = Math.min(limit, MAX_LIMIT);
  }
  if (date_from !== null && date_to !== null && (date_from as string) > (date_to as string)) {
    return { ok: false, error: "date_from must be on or before date_to." };
  }
  if (amount_min !== null && amount_max !== null && (amount_min as number) > (amount_max as number)) {
    return { ok: false, error: "amount_min must be <= amount_max." };
  }

  return {
    ok: true,
    value: {
      sender_contains: sender_contains as string | null,
      date_from: date_from as string | null,
      date_to: date_to as string | null,
      amount_min: amount_min as number | null,
      amount_max: amount_max as number | null,
      currency: currency ? (currency as string).toUpperCase() : null,
      needs_review: typeof nr === "boolean" ? nr : null,
      limit,
    },
  };
}

/** Lower-case, accent-free, single-spaced: "Société  Générale" -> "societe generale". */
export function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Amounts have at most 3 decimals (TND); rounding removes binary float noise from sums. */
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

type Totals = { currency: string; count: number; sum: number; min: number; max: number; average: number };

export type SearchResult = {
  total_in_store: number;
  matched_count: number;
  matched_without_amount: number;
  totals_by_currency: Totals[];
  date_range: { earliest: string; latest: string } | null;
  top_senders: { sender: string; count: number; sums: { currency: string; sum: number }[] }[];
  returned_count: number;
  truncated: boolean;
  transfers: {
    file_name: string;
    sender: string | null;
    amount: number | null;
    currency: string | null;
    date: string | null;
    needs_review: boolean;
    analysed_at: string;
  }[];
};

export function searchTransfers(all: HistoryItem[], input: SearchInput): SearchResult {
  const needle = input.sender_contains ? fold(input.sender_contains) : null;

  const matches = all.filter(({ result: r }) => {
    if (needle !== null && (r.sender === null || !fold(r.sender).includes(needle))) return false;
    if (input.date_from !== null && (r.date === null || r.date < input.date_from)) return false;
    if (input.date_to !== null && (r.date === null || r.date > input.date_to)) return false;
    if (input.amount_min !== null && (r.amount === null || r.amount < input.amount_min)) return false;
    if (input.amount_max !== null && (r.amount === null || r.amount > input.amount_max)) return false;
    if (input.currency !== null && (r.currency ?? "").toUpperCase() !== input.currency) return false;
    if (input.needs_review !== null && r.needs_review !== input.needs_review) return false;
    return true;
  });

  return summarizeTransfers(matches, all.length, input.limit);
}

/**
 * Builds the tool result from transfers that already match the filters
 * (selected in SQL by the store, or by `searchTransfers` above).
 */
export function summarizeTransfers(matches: HistoryItem[], totalInStore: number, limitInput: number | null): SearchResult {
  // Aggregates are computed over ALL matches, not just the returned page.
  const totals = new Map<string, { count: number; sum: number; min: number; max: number }>();
  const senders = new Map<string, { sender: string; count: number; sums: Map<string, number> }>();
  let earliest: string | null = null;
  let latest: string | null = null;
  let withoutAmount = 0;

  for (const { result: r } of matches) {
    const cur = r.currency ? r.currency.toUpperCase() : UNKNOWN_CURRENCY;

    if (r.amount === null) withoutAmount++;
    else {
      const t = totals.get(cur);
      if (t) {
        t.count++;
        t.sum += r.amount;
        t.min = Math.min(t.min, r.amount);
        t.max = Math.max(t.max, r.amount);
      } else totals.set(cur, { count: 1, sum: r.amount, min: r.amount, max: r.amount });
    }

    if (r.date !== null) {
      if (earliest === null || r.date < earliest) earliest = r.date;
      if (latest === null || r.date > latest) latest = r.date;
    }

    if (r.sender !== null) {
      const key = fold(r.sender);
      let s = senders.get(key);
      if (!s) senders.set(key, (s = { sender: r.sender, count: 0, sums: new Map() }));
      s.count++;
      if (r.amount !== null) s.sums.set(cur, (s.sums.get(cur) ?? 0) + r.amount);
    }
  }

  const sorted = [...matches].sort((a, b) => {
    const da = a.result.date;
    const db = b.result.date;
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? 1 : -1;
    }
    return b.at - a.at;
  });
  const limit = Math.min(limitInput ?? DEFAULT_LIMIT, MAX_LIMIT);
  const page = sorted.slice(0, limit);

  return {
    total_in_store: totalInStore,
    matched_count: matches.length,
    matched_without_amount: withoutAmount,
    totals_by_currency: [...totals.entries()]
      .map(([currency, t]) => ({
        currency,
        count: t.count,
        sum: round(t.sum),
        min: t.min,
        max: t.max,
        average: round(t.sum / t.count),
      }))
      .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency)),
    date_range: earliest !== null && latest !== null ? { earliest, latest } : null,
    top_senders: [...senders.values()]
      .map((s) => ({
        sender: s.sender,
        count: s.count,
        sums: [...s.sums.entries()].map(([currency, sum]) => ({ currency, sum: round(sum) })),
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          Math.max(0, ...b.sums.map((x) => x.sum)) - Math.max(0, ...a.sums.map((x) => x.sum)) ||
          a.sender.localeCompare(b.sender),
      )
      .slice(0, 10),
    returned_count: page.length,
    truncated: page.length < matches.length,
    transfers: page.map((i) => ({
      file_name: i.fileName,
      sender: i.result.sender,
      amount: i.result.amount,
      currency: i.result.currency,
      date: i.result.date,
      needs_review: i.result.needs_review,
      analysed_at: new Date(i.at).toISOString(),
    })),
  };
}
