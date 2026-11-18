import "server-only";
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { SessionUser, TransferScope } from "@/lib/auth/types";
import { dataDir } from "@/lib/db-migrate.mjs";
import { db } from "@/lib/db";
import { fold, type SearchInput } from "@/lib/transfer-search";
import type { HistoryItem } from "@/lib/types";
import { writeAuditEvent } from "@/lib/users";

/**
 * SQLite store for the extracted transfers (never the PDF, never the OCR text).
 * Every query uses bound parameters, and every read takes a TransferScope, so a query
 * cannot forget the role filter without failing type-checking.
 */
type Row = {
  id: string;
  file_name: string;
  analysed_at: number;
  sender: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  needs_review: number;
  warnings: string;
  owner_name?: string | null;
};

const COLUMNS = "t.id, t.file_name, t.analysed_at, t.sender, t.amount, t.currency, t.date, t.needs_review, t.warnings";

let legacyChecked = false;

function store(): Database.Database {
  const conn = db();
  if (!legacyChecked) {
    legacyChecked = true;
    importLegacyJson(conn);
  }
  return conn;
}

function scopeSql(scope: TransferScope): { sql: string; params: Record<string, string> } {
  return scope.kind === "all"
    ? { sql: "1 = 1", params: {} }
    : { sql: "t.owner_id = @scope_owner", params: { scope_owner: scope.userId } };
}

const INSERT = `
  INSERT OR IGNORE INTO transfers
    (id, file_name, analysed_at, sender, sender_folded, amount, currency, date, needs_review, warnings, owner_id)
  VALUES
    (@id, @file_name, @analysed_at, @sender, @sender_folded, @amount, @currency, @date, @needs_review, @warnings, @owner_id)
`;

function toParams(item: HistoryItem, ownerId: string | null) {
  const r = item.result;
  return {
    id: item.id,
    file_name: item.fileName,
    analysed_at: item.at,
    sender: r.sender,
    sender_folded: r.sender === null ? null : fold(r.sender),
    amount: r.amount,
    currency: r.currency,
    date: r.date,
    needs_review: r.needs_review ? 1 : 0,
    warnings: JSON.stringify(r.warnings ?? []),
    owner_id: ownerId,
  };
}

function toItem(row: Row): HistoryItem {
  let warnings: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.warnings);
    if (Array.isArray(parsed)) warnings = parsed.filter((w): w is string => typeof w === "string");
  } catch {
    /* keep [] */
  }
  return {
    id: row.id,
    fileName: row.file_name,
    at: row.analysed_at,
    ...(row.owner_name !== undefined ? { owner: row.owner_name } : {}),
    result: {
      is_bank_transfer: true, // only bank transfers are ever stored
      sender: row.sender,
      amount: row.amount,
      currency: row.currency,
      date: row.date,
      needs_review: row.needs_review === 1,
      warnings,
    },
  };
}

/** One-time import of the old JSON store, which is then renamed so it is not imported twice. */
function importLegacyJson(conn: Database.Database) {
  const legacyJson = path.join(dataDir(), "transfers.json");
  if (!fs.existsSync(legacyJson)) return;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(legacyJson, "utf8"));
    const items = (Array.isArray(parsed) ? parsed : []).filter(isLegacyItem);
    const insert = conn.prepare(INSERT);
    conn.transaction((rows: HistoryItem[]) => {
      for (const item of rows) insert.run(toParams(item, null));
    })(items);
    fs.renameSync(legacyJson, `${legacyJson}.imported`);
  } catch (e) {
    console.error("[store] could not import transfers.json:", e instanceof Error ? e.message : e);
  }
}

function isLegacyItem(v: unknown): v is HistoryItem {
  if (typeof v !== "object" || v === null) return false;
  const i = v as Record<string, unknown>;
  const r = i.result as Record<string, unknown> | null | undefined;
  const nullable = (x: unknown, type: "string" | "number") => x === null || typeof x === type;
  return (
    typeof i.id === "string" &&
    typeof i.fileName === "string" &&
    typeof i.at === "number" &&
    typeof r === "object" &&
    r !== null &&
    r.is_bank_transfer === true &&
    nullable(r.sender, "string") &&
    nullable(r.amount, "number") &&
    nullable(r.currency, "string") &&
    nullable(r.date, "string") &&
    typeof r.needs_review === "boolean"
  );
}

/** Transfers visible in this scope, newest first. Admins also get the uploader's name. */
export async function listTransfers(scope: TransferScope): Promise<HistoryItem[]> {
  const { sql, params } = scopeSql(scope);
  const owner = scope.kind === "all" ? ", u.display_name AS owner_name" : "";
  const join = scope.kind === "all" ? "LEFT JOIN users u ON u.id = t.owner_id" : "";
  const rows = store()
    .prepare(`SELECT ${COLUMNS}${owner} FROM transfers t ${join} WHERE ${sql} ORDER BY t.analysed_at DESC`)
    .all(params) as Row[];
  return rows.map((row) => toItem(scope.kind === "all" ? { ...row, owner_name: row.owner_name ?? null } : row));
}

export async function addTransfer(item: HistoryItem, ownerId: string): Promise<HistoryItem> {
  store().prepare(INSERT).run(toParams(item, ownerId));
  return item;
}

/** Deletes every transfer. Admin only, and recorded in the audit log in the same transaction. */
export async function clearAllTransfers(admin: SessionUser): Promise<number> {
  if (admin.role !== "admin") throw new Error("clearAllTransfers requires an admin");
  const conn = store();
  return conn
    .transaction(() => {
      const { changes } = conn.prepare("DELETE FROM transfers").run();
      writeAuditEvent("history_cleared", admin.id, null, { rows: changes });
      return changes;
    })
    .immediate();
}

export async function countTransfers(scope: TransferScope): Promise<number> {
  const { sql, params } = scopeSql(scope);
  return (store().prepare(`SELECT COUNT(*) AS n FROM transfers t WHERE ${sql}`).get(params) as { n: number }).n;
}

/**
 * Transfers matching the chat assistant's search filters, selected in SQL.
 * Returns every match in scope (the caller aggregates over all of them and pages the rows).
 */
export async function findTransfers(
  input: SearchInput,
  scope: TransferScope,
): Promise<{ total: number; matches: HistoryItem[] }> {
  const scoped = scopeSql(scope);
  const where: string[] = [scoped.sql];
  const params: Record<string, string | number> = { ...scoped.params };

  if (input.sender_contains !== null) {
    // LIKE wildcards in the needle are escaped so they match literally.
    where.push("t.sender_folded LIKE @sender ESCAPE '\\'");
    params.sender = `%${fold(input.sender_contains).replace(/[\\%_]/g, "\\$&")}%`;
  }
  if (input.date_from !== null) {
    where.push("t.date >= @date_from");
    params.date_from = input.date_from;
  }
  if (input.date_to !== null) {
    where.push("t.date <= @date_to");
    params.date_to = input.date_to;
  }
  if (input.amount_min !== null) {
    where.push("t.amount >= @amount_min");
    params.amount_min = input.amount_min;
  }
  if (input.amount_max !== null) {
    where.push("t.amount <= @amount_max");
    params.amount_max = input.amount_max;
  }
  if (input.currency !== null) {
    where.push("UPPER(t.currency) = @currency");
    params.currency = input.currency.toUpperCase();
  }
  if (input.needs_review !== null) {
    where.push("t.needs_review = @needs_review");
    params.needs_review = input.needs_review ? 1 : 0;
  }

  const sql = `SELECT ${COLUMNS} FROM transfers t WHERE ${where.join(" AND ")} ORDER BY t.analysed_at DESC`;
  const rows = store().prepare(sql).all(params) as Row[];
  return { total: await countTransfers(scope), matches: rows.map(toItem) };
}
