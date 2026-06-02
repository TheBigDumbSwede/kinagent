import type { FirestoreDocumentLike } from "../firestore/types.js";
import { decryptKindroidValue } from "../kindroid/kindroidCrypto.js";

export interface CapturedField {
  kind: "string" | "number" | "boolean" | "array" | "object" | "null" | "unknown";
  encrypted?: boolean;
  decrypted?: boolean;
  rawLength?: number;
  valueLength?: number;
  value?: unknown;
  keys?: string[];
  count?: number;
}

export interface CapturedDocument {
  id: string;
  createTime?: string;
  updateTime?: string;
  fields: Record<string, CapturedField>;
}

interface CapturedNestedValue {
  value: unknown;
  encrypted: boolean;
  decrypted: boolean;
}

export function captureDocument(
  document: FirestoreDocumentLike,
  decryptionKey: string,
  fields: readonly string[]
): CapturedDocument {
  const data = document.data();
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const capturedFields = Object.fromEntries(
    fields.filter((field) => field in record).map((field) => [field, captureValue(record[field], decryptionKey)])
  );

  return {
    id: document.id,
    createTime: typeof record._createTime === "string" ? record._createTime : undefined,
    updateTime: typeof record._updateTime === "string" ? record._updateTime : undefined,
    fields: capturedFields
  };
}

export function captureValue(value: unknown, decryptionKey: string): CapturedField {
  if (typeof value === "string") {
    const decrypted = decryptKindroidValue(value, decryptionKey);
    return {
      kind: "string",
      encrypted: decrypted.encrypted,
      decrypted: decrypted.decrypted,
      rawLength: value.length,
      valueLength: decrypted.value.length,
      value: decrypted.value
    };
  }

  if (typeof value === "number") {
    return { kind: "number", value };
  }

  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }

  if (value === null) {
    return { kind: "null", value: null };
  }

  if (Array.isArray(value)) {
    const captured = captureNestedValue(value, decryptionKey);
    return {
      kind: "array",
      count: value.length,
      encrypted: captured.encrypted || undefined,
      decrypted: captured.decrypted || undefined,
      value: captured.value
    };
  }

  if (typeof value === "object" && value !== null) {
    const captured = captureNestedValue(value, decryptionKey);
    return {
      kind: "object",
      keys: Object.keys(value).sort(),
      encrypted: captured.encrypted || undefined,
      decrypted: captured.decrypted || undefined,
      value: captured.value
    };
  }

  return { kind: "unknown" };
}

function captureNestedValue(value: unknown, decryptionKey: string): CapturedNestedValue {
  if (typeof value === "string") {
    const decrypted = decryptKindroidValue(value, decryptionKey);
    return {
      value: decrypted.value,
      encrypted: decrypted.encrypted,
      decrypted: decrypted.decrypted
    };
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => captureNestedValue(item, decryptionKey));
    return {
      value: items.map((item) => item.value),
      encrypted: items.some((item) => item.encrypted),
      decrypted: items.some((item) => item.decrypted)
    };
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [key, captureNestedValue(item, decryptionKey)] as const);
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
      encrypted: entries.some(([, item]) => item.encrypted),
      decrypted: entries.some(([, item]) => item.decrypted)
    };
  }

  return {
    value,
    encrypted: false,
    decrypted: false
  };
}
