import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { InMemoryDedupeStore, type DedupeMatch, type DedupeStore, type OutboundMessageRecord } from "./dedupeStore.js";
import { hashText } from "../util/ids.js";

export class SQLiteDedupeStore implements DedupeStore {
  private constructor(
    private readonly sqlitePath: string,
    private readonly database: Database,
    private readonly windowMs: number
  ) {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS outbound_messages (
        kin_id TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        confirmed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_messages_match
        ON outbound_messages (kin_id, text_hash, timestamp);
    `);
    this.persist();
  }

  static async open(sqlitePath: string, dedupeWindowSeconds: number): Promise<SQLiteDedupeStore> {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    const SQL = await loadSqlJs();
    const database = fs.existsSync(sqlitePath) ? new SQL.Database(fs.readFileSync(sqlitePath)) : new SQL.Database();

    return new SQLiteDedupeStore(sqlitePath, database, dedupeWindowSeconds * 1000);
  }

  async recordOutbound(input: {
    kinId: string;
    text: string;
    requestId: string;
    idempotencyKey: string;
  }): Promise<OutboundMessageRecord> {
    const now = Date.now();
    this.prune(now);

    const record: OutboundMessageRecord = {
      kinId: input.kinId,
      textHash: hashText(input.text),
      timestamp: now,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey
    };

    this.database.run(
      `
        INSERT INTO outbound_messages
          (kin_id, text_hash, timestamp, request_id, idempotency_key, confirmed_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `,
      [record.kinId, record.textHash, record.timestamp, record.requestId, record.idempotencyKey]
    );
    this.persist();

    return record;
  }

  async matchRecentOutbound(input: { kinId: string; text: string; now?: number }): Promise<DedupeMatch> {
    const now = input.now ?? Date.now();
    this.prune(now);

    const statement = this.database.prepare(`
      SELECT kin_id, text_hash, timestamp, request_id, idempotency_key, confirmed_at
      FROM outbound_messages
      WHERE kin_id = ? AND text_hash = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    try {
      statement.bind([input.kinId, hashText(input.text)]);
      if (!statement.step()) {
        return { matched: false };
      }

      const row = statement.getAsObject();
      if (!isOutboundRow(row)) {
        return { matched: false };
      }

      return {
        matched: true,
        record: rowToRecord(row)
      };
    } finally {
      statement.free();
    }
  }

  async confirm(record: OutboundMessageRecord, confirmedAt = Date.now()): Promise<void> {
    this.database.run(
      `
        UPDATE outbound_messages
        SET confirmed_at = ?
        WHERE kin_id = ? AND text_hash = ? AND request_id = ? AND idempotency_key = ?
      `,
      [confirmedAt, record.kinId, record.textHash, record.requestId, record.idempotencyKey]
    );
    this.persist();
    record.confirmedAt = confirmedAt;
  }

  private prune(now: number): void {
    this.database.run("DELETE FROM outbound_messages WHERE timestamp < ?", [now - this.windowMs]);
    this.persist();
  }

  private persist(): void {
    fs.writeFileSync(this.sqlitePath, Buffer.from(this.database.export()));
  }
}

export async function createDedupeStore(sqlitePath: string, dedupeWindowSeconds: number): Promise<DedupeStore> {
  if (process.env.KINAGENT_DEDUPE_STORE === "memory") {
    return new InMemoryDedupeStore(dedupeWindowSeconds * 1000);
  }

  return SQLiteDedupeStore.open(sqlitePath, dedupeWindowSeconds);
}

interface OutboundRow {
  kin_id: string;
  text_hash: string;
  timestamp: number;
  request_id: string;
  idempotency_key: string;
  confirmed_at: number | null;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });
  return sqlJsPromise;
}

function isOutboundRow(value: unknown): value is OutboundRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.kin_id === "string" &&
    typeof row.text_hash === "string" &&
    typeof row.timestamp === "number" &&
    typeof row.request_id === "string" &&
    typeof row.idempotency_key === "string" &&
    (typeof row.confirmed_at === "number" || row.confirmed_at === null)
  );
}

function rowToRecord(row: OutboundRow): OutboundMessageRecord {
  return {
    kinId: row.kin_id,
    textHash: row.text_hash,
    timestamp: row.timestamp,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    confirmedAt: row.confirmed_at ?? undefined
  };
}
