import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export interface GroupSubscriptionPreferences {
  disabledGroupIds: Set<string>;
  soundscape: Map<string, GroupSoundscapePreference>;
}

export interface GroupSoundscapePreference {
  enabled: boolean;
}

export function loadGroupSubscriptionPreferences(config: AppConfig): GroupSubscriptionPreferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(groupSubscriptionPreferencesPath(config), "utf8")) as {
      disabledGroupIds?: unknown;
      soundscape?: unknown;
    };
    const disabled = Array.isArray(parsed.disabledGroupIds)
      ? parsed.disabledGroupIds.filter(
          (groupId): groupId is string => typeof groupId === "string" && groupId.length > 0
        )
      : [];
    return {
      disabledGroupIds: new Set(disabled),
      soundscape: parseSoundscapePreferences(parsed.soundscape)
    };
  } catch {
    return { disabledGroupIds: new Set(), soundscape: new Map() };
  }
}

export function saveGroupSubscriptionPreferences(config: AppConfig, preferences: GroupSubscriptionPreferences): void {
  const preferencesPath = groupSubscriptionPreferencesPath(config);
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify(
      {
        disabledGroupIds: [...preferences.disabledGroupIds].sort(),
        soundscape: Object.fromEntries(
          [...preferences.soundscape.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([groupId, preference]) => [groupId, normalizeGroupSoundscapePreference(preference)])
        )
      },
      null,
      2
    )}\n`
  );
}

export function groupSubscriptionPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "group-subscriptions.json");
}

export function normalizeGroupSoundscapePreference(
  preference: Partial<GroupSoundscapePreference> = {}
): GroupSoundscapePreference {
  return {
    enabled: preference.enabled === true
  };
}

function parseSoundscapePreferences(value: unknown): Map<string, GroupSoundscapePreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([groupId, raw]) => {
    if (!groupId || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }
    const record = raw as Record<string, unknown>;
    return [[groupId, normalizeGroupSoundscapePreference({ enabled: record.enabled === true })] as const];
  });

  return new Map(entries);
}
