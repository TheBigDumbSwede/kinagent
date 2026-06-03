import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export interface KinSubscriptionPreferences {
  disabledKinIds: Set<string>;
  ambientDisabledKinIds: Set<string>;
}

export function loadKinSubscriptionPreferences(config: AppConfig): KinSubscriptionPreferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(kinSubscriptionPreferencesPath(config), "utf8")) as {
      disabledKinIds?: unknown;
      ambientDisabledKinIds?: unknown;
    };
    const disabled = Array.isArray(parsed.disabledKinIds)
      ? parsed.disabledKinIds.filter((kinId): kinId is string => typeof kinId === "string" && kinId.length > 0)
      : [];
    const ambientDisabled = Array.isArray(parsed.ambientDisabledKinIds)
      ? parsed.ambientDisabledKinIds.filter((kinId): kinId is string => typeof kinId === "string" && kinId.length > 0)
      : [];
    return { disabledKinIds: new Set(disabled), ambientDisabledKinIds: new Set(ambientDisabled) };
  } catch {
    return { disabledKinIds: new Set(), ambientDisabledKinIds: new Set() };
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
        ambientDisabledKinIds: [...preferences.ambientDisabledKinIds].sort()
      },
      null,
      2
    )}\n`
  );
}

export function kinSubscriptionPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "kin-subscriptions.json");
}
