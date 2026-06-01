import type { FirestoreDocumentLike, NormalizedKindroidMessage } from "./types.js";
import { decryptKindroidValue } from "../kindroid/kindroidCrypto.js";

const textKeys = ["text", "body", "message", "content", "msg"];
const senderKeys = ["sender", "author", "from", "user"];
const roleKeys = ["role", "senderRole", "authorRole"];
const timestampKeys = ["timestamp", "createdAt", "created_at", "time", "sentAt", "_createTime", "_updateTime"];

export interface MapKindroidMessageOptions {
  decryptionKey?: string;
}

export function mapKindroidMessage(
  doc: FirestoreDocumentLike,
  kinId: string,
  options: MapKindroidMessageOptions = {}
): NormalizedKindroidMessage {
  const raw = doc.data();
  const record = isRecord(raw) ? raw : {};
  const rawText = stringValue(firstValue(record, textKeys));
  const decryptedText = rawText && options.decryptionKey ? decryptKindroidValue(rawText, options.decryptionKey) : null;

  return {
    id: doc.id,
    kinId,
    timestamp: normalizeTimestamp(firstValue(record, timestampKeys)),
    text: decryptedText?.value ?? rawText,
    textEncrypted: decryptedText?.encrypted ?? (rawText?.startsWith("!enc:") || undefined),
    textDecrypted: decryptedText?.decrypted,
    textDecryptionError: decryptedText?.error,
    sender: stringValue(firstValue(record, senderKeys)),
    role: stringValue(firstValue(record, roleKeys)),
    raw
  };
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (isRecord(value)) {
    if (typeof value.toDate === "function") {
      return (value.toDate() as Date).toISOString();
    }

    if (typeof value.seconds === "number") {
      return new Date(value.seconds * 1000).toISOString();
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
