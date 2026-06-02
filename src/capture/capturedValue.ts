import type { FirestoreDocumentLike } from "../firestore/types.js";
import { decryptKindroidValue } from "../kindroid/kindroidCrypto.js";

export interface CapturedField {
  kind: "string" | "number" | "boolean" | "array" | "object" | "null" | "unknown";
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
      value: captured.value
    };
  }

  if (typeof value === "object" && value !== null) {
    const captured = captureNestedValue(value, decryptionKey);
    return {
      kind: "object",
      keys: Object.keys(value).sort(),
      value: captured.value
    };
  }

  return { kind: "unknown" };
}

function captureNestedValue(value: unknown, decryptionKey: string): CapturedNestedValue {
  if (typeof value === "string") {
    const decrypted = decryptKindroidValue(value, decryptionKey);
    return {
      value: decrypted.value
    };
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => captureNestedValue(item, decryptionKey));
    return {
      value: items.map((item) => item.value)
    };
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [key, captureNestedValue(item, decryptionKey)] as const);
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value]))
    };
  }

  return {
    value
  };
}
