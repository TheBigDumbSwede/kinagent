import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export interface GroupSubscriptionPreferences {
  disabledGroupIds: Set<string>;
}

export function loadGroupSubscriptionPreferences(config: AppConfig): GroupSubscriptionPreferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(groupSubscriptionPreferencesPath(config), "utf8")) as {
      disabledGroupIds?: unknown;
    };
    const disabled = Array.isArray(parsed.disabledGroupIds)
      ? parsed.disabledGroupIds.filter(
          (groupId): groupId is string => typeof groupId === "string" && groupId.length > 0
        )
      : [];
    return { disabledGroupIds: new Set(disabled) };
  } catch {
    return { disabledGroupIds: new Set() };
  }
}

export function saveGroupSubscriptionPreferences(config: AppConfig, preferences: GroupSubscriptionPreferences): void {
  const preferencesPath = groupSubscriptionPreferencesPath(config);
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify({ disabledGroupIds: [...preferences.disabledGroupIds].sort() }, null, 2)}\n`
  );
}

export function groupSubscriptionPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "group-subscriptions.json");
}
