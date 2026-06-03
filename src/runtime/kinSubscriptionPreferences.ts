import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import { clampChatDynamism, defaultChatDynamismBounds, practicalChatDynamismBounds } from "../kindroid/chatDynamism.js";

export interface KinSubscriptionPreferences {
  disabledKinIds: Set<string>;
  ambientDisabledKinIds: Set<string>;
  chatDynamism: Map<string, KinChatDynamismPreference>;
}

export interface KinChatDynamismPreference {
  enabled: boolean;
  min: number;
  max: number;
}

export function loadKinSubscriptionPreferences(config: AppConfig): KinSubscriptionPreferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8")) as {
      disabledKinIds?: unknown;
      ambientDisabledKinIds?: unknown;
      chatDynamism?: unknown;
    };
    const disabled = Array.isArray(parsed.disabledKinIds)
      ? parsed.disabledKinIds.filter((kinId): kinId is string => typeof kinId === "string" && kinId.length > 0)
      : [];
    const ambientDisabled = Array.isArray(parsed.ambientDisabledKinIds)
      ? parsed.ambientDisabledKinIds.filter((kinId): kinId is string => typeof kinId === "string" && kinId.length > 0)
      : [];
    return {
      disabledKinIds: new Set(disabled),
      ambientDisabledKinIds: new Set(ambientDisabled),
      chatDynamism: parseChatDynamismPreferences(parsed.chatDynamism)
    };
  } catch {
    return { disabledKinIds: new Set(), ambientDisabledKinIds: new Set(), chatDynamism: new Map() };
  }
}

export function saveKinSubscriptionPreferences(config: AppConfig, preferences: KinSubscriptionPreferences): void {
  const preferencesPath = kinSubscriptionPreferencesPath(config);
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify(
      {
        disabledKinIds: [...preferences.disabledKinIds].sort(),
        ambientDisabledKinIds: [...preferences.ambientDisabledKinIds].sort(),
        chatDynamism: Object.fromEntries(
          [...preferences.chatDynamism.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([kinId, preference]) => [kinId, normalizeChatDynamismPreference(preference)])
        )
      },
      null,
      2
    )}\n`
  );
}

export function kinSubscriptionPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "kin-subscriptions.json");
}

function parseChatDynamismPreferences(value: unknown): Map<string, KinChatDynamismPreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([kinId, raw]) => {
    if (!kinId || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }
    const record = raw as Record<string, unknown>;
    const enabled = record.enabled === true;
    const min = numberValue(record.min, practicalChatDynamismBounds.min);
    const max = numberValue(record.max, practicalChatDynamismBounds.max);
    return [[kinId, normalizeChatDynamismPreference({ enabled, min, max })] as const];
  });

  return new Map(entries);
}

export function normalizeChatDynamismPreference(
  preference: Partial<KinChatDynamismPreference> = {}
): KinChatDynamismPreference {
  const min = numberValue(preference.min, practicalChatDynamismBounds.min);
  const max = numberValue(preference.max, practicalChatDynamismBounds.max);
  const sortedMin = clampChatDynamism(Math.min(min, max), defaultChatDynamismBounds);
  const sortedMax = clampChatDynamism(Math.max(min, max), defaultChatDynamismBounds);
  return {
    enabled: preference.enabled === true,
    min: Number(sortedMin.toFixed(2)),
    max: Number(sortedMax.toFixed(2))
  };
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
