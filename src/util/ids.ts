import crypto from "node:crypto";

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(normalizeText(text)).digest("hex");
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
