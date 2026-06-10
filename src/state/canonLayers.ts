export const canonLayerIds = [
  "hard_canon",
  "soft_canon",
  "scene_state",
  "user_preference",
  "system_observation",
  "game_state"
] as const;

export type CanonLayerId = (typeof canonLayerIds)[number];

export const canonLayerDefinitions: Record<
  CanonLayerId,
  {
    label: string;
    summary: string;
  }
> = {
  hard_canon: {
    label: "Hard canon",
    summary: "User-approved stable facts suitable for durable memory or durable Kindroid-facing changes."
  },
  soft_canon: {
    label: "Soft canon",
    summary: "Repeated or likely facts that remain provisional until reviewed or reinforced."
  },
  scene_state: {
    label: "Scene state",
    summary: "Temporary current-scene facts such as location, objects, tone, participants, and unresolved beats."
  },
  user_preference: {
    label: "User preference",
    summary: "User taste and experience-shaping preferences that should guide Kinagent behavior."
  },
  system_observation: {
    label: "System observation",
    summary: "Diagnostics, health signals, drift observations, and non-canonical analysis."
  },
  game_state: {
    label: "Game state",
    summary: "Validated campaign, mystery, character, roll, and clue state owned by Kinagent."
  }
};

export const canonConfidenceLevels = ["low", "medium", "high"] as const;
export type CanonConfidence = (typeof canonConfidenceLevels)[number];

export const canonProvenanceSourceTypes = [
  "chat_message",
  "chat_history",
  "hermes_action",
  "user_review",
  "kindroid_api",
  "campaign_pack",
  "diagnostic",
  "local_runtime",
  "manual"
] as const;
export type CanonProvenanceSourceType = (typeof canonProvenanceSourceTypes)[number];

export const canonLifecycleStatuses = [
  "candidate",
  "active",
  "accepted",
  "dismissed",
  "stale",
  "source_invalidated",
  "expired",
  "superseded",
  "remediated"
] as const;
export type CanonLifecycleStatus = (typeof canonLifecycleStatuses)[number];

export type CanonScope =
  | { scope: "kin"; kinId: string; groupId?: never }
  | { scope: "group"; groupId: string; kinId?: string | null }
  | { scope: "global"; kinId?: never; groupId?: never };

export interface CanonProvenanceInput {
  sourceType?: unknown;
  sourceId?: unknown;
  sourceDocumentId?: unknown;
  sourceTimestamp?: unknown;
  observedAt?: unknown;
  actor?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  reason?: unknown;
  lifecycleStatus?: unknown;
}

export interface CanonProvenance {
  sourceType?: CanonProvenanceSourceType;
  sourceId?: string;
  sourceDocumentId?: string;
  sourceTimestamp?: string | null;
  observedAt?: string;
  actor?: string;
  confidence?: CanonConfidence;
  evidence?: string[];
  reason?: string;
  lifecycleStatus?: CanonLifecycleStatus;
}

const canonLayerAliases: Record<string, CanonLayerId> = {
  hardcanon: "hard_canon",
  hard_canon: "hard_canon",
  durable_memory: "hard_canon",
  durable_fact: "hard_canon",
  softcanon: "soft_canon",
  soft_canon: "soft_canon",
  provisional_fact: "soft_canon",
  inferred_fact: "soft_canon",
  scenecanon: "scene_state",
  scene_canon: "scene_state",
  scene_state: "scene_state",
  current_scene_state: "scene_state",
  scene: "scene_state",
  userpreference: "user_preference",
  user_preference: "user_preference",
  preference: "user_preference",
  systemobservation: "system_observation",
  system_observation: "system_observation",
  observation: "system_observation",
  diagnostic: "system_observation",
  diagnostics: "system_observation",
  gamestate: "game_state",
  game_state: "game_state",
  gaming: "game_state",
  campaign_state: "game_state"
};

const sourceTypeAliases: Record<string, CanonProvenanceSourceType> = {
  chat_message: "chat_message",
  message: "chat_message",
  chat_history: "chat_history",
  history: "chat_history",
  hermes_action: "hermes_action",
  hermes: "hermes_action",
  user_review: "user_review",
  review: "user_review",
  kindroid_api: "kindroid_api",
  kindroid: "kindroid_api",
  campaign_pack: "campaign_pack",
  campaign: "campaign_pack",
  diagnostic: "diagnostic",
  diagnostics: "diagnostic",
  local_runtime: "local_runtime",
  runtime: "local_runtime",
  manual: "manual",
  user: "manual"
};

export function normalizeCanonLayerId(value: unknown): CanonLayerId | null {
  const key = canonicalKey(value);
  return key ? (canonLayerAliases[key] ?? null) : null;
}

export function isCanonLayerId(value: unknown): value is CanonLayerId {
  return normalizeCanonLayerId(value) === value;
}

export function normalizeCanonProvenance(input: CanonProvenanceInput): CanonProvenance {
  return compactProvenance({
    sourceType: normalizeSourceType(input.sourceType),
    sourceId: optionalText(input.sourceId, 160),
    sourceDocumentId: optionalText(input.sourceDocumentId, 160),
    sourceTimestamp: optionalTimestamp(input.sourceTimestamp),
    observedAt: optionalTimestamp(input.observedAt) ?? undefined,
    actor: optionalText(input.actor, 80),
    confidence: normalizeEnum(input.confidence, canonConfidenceLevels),
    evidence: normalizeStringArray(input.evidence, 8, 220),
    reason: optionalText(input.reason, 280),
    lifecycleStatus: normalizeLifecycleStatus(input.lifecycleStatus)
  });
}

function normalizeSourceType(value: unknown): CanonProvenanceSourceType | undefined {
  const key = canonicalKey(value);
  return key ? sourceTypeAliases[key] : undefined;
}

function normalizeLifecycleStatus(value: unknown): CanonLifecycleStatus | undefined {
  return normalizeEnum(value, canonLifecycleStatuses);
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  const key = canonicalKey(value);
  return allowed.find((item) => item === key);
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  const text = optionalText(value, 80);
  if (!text) {
    return undefined;
  }
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : undefined;
}

function normalizeStringArray(value: unknown, maxCount: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = [
    ...new Set(value.map((item) => optionalText(item, maxLength)).filter((item): item is string => Boolean(item)))
  ].slice(0, maxCount);
  return normalized.length > 0 ? normalized : undefined;
}

function canonicalKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

function compactProvenance(provenance: CanonProvenance): CanonProvenance {
  return Object.fromEntries(Object.entries(provenance).filter(([, value]) => value !== undefined)) as CanonProvenance;
}
