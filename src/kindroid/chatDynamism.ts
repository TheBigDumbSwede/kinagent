export interface ChatDynamismValue {
  raw: unknown;
  numeric: number | null;
  display: string;
}

export interface ChatDynamismBounds {
  min: number;
  max: number;
  step: number;
}

export const noticeableChatDynamismDelta = 0.05;
export const recommendedChatDynamismStartingValue = 0.95;

export const defaultChatDynamismBounds: ChatDynamismBounds = {
  min: 0.6,
  max: 1.8,
  step: noticeableChatDynamismDelta
};

export const practicalChatDynamismBounds: ChatDynamismBounds = {
  min: 0.8,
  max: 1.4,
  step: defaultChatDynamismBounds.step
};

export function parseChatDynamismValue(raw: unknown): ChatDynamismValue {
  const numeric = numericValue(raw);
  return {
    raw,
    numeric,
    display: numeric === null ? displayRawValue(raw) : numeric.toFixed(2).replace(/\.?0+$/, "")
  };
}

export function normalizeChatDynamismInput(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(numeric)) {
    throw new Error("Chat Dynamism must be a finite number.");
  }

  return numeric;
}

export function clampChatDynamism(value: number, bounds: ChatDynamismBounds = defaultChatDynamismBounds): number {
  if (!Number.isFinite(value)) {
    throw new Error("Chat Dynamism must be a finite number.");
  }
  if (bounds.min > bounds.max) {
    throw new Error("Chat Dynamism bounds are invalid.");
  }

  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function roundChatDynamismStep(value: number, step = defaultChatDynamismBounds.step): number {
  if (!Number.isFinite(value)) {
    throw new Error("Chat Dynamism must be a finite number.");
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("Chat Dynamism step must be a positive number.");
  }

  const decimals = decimalPlaces(step);
  return Number((Math.round(value / step) * step).toFixed(Math.max(0, decimals)));
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function displayRawValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "(not set)";
  }
  if (typeof raw === "string") {
    return raw;
  }
  return JSON.stringify(raw) ?? String(raw);
}

function decimalPlaces(value: number): number {
  const text = value.toString();
  if (!text.includes(".")) {
    return 0;
  }

  return text.split(".")[1]?.length ?? 0;
}
