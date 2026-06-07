import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export type GamingAutomationMode = "observe" | "suggest" | "autonomous";

export interface GroupGamingPreference {
  enabled: boolean;
  campaignId?: string;
  mysteryId?: string;
  automationMode: GamingAutomationMode;
}

interface GroupGamingPreferenceFile {
  groups?: Record<string, GroupGamingPreference>;
}

export class GroupGamingPreferenceStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): GroupGamingPreferenceStore {
    return new GroupGamingPreferenceStore(groupGamingPreferencesPath(config));
  }

  get(groupId: string): GroupGamingPreference {
    return normalizeGroupGamingPreference(this.read().groups?.[groupId]);
  }

  set(groupId: string, preference: Partial<GroupGamingPreference>): GroupGamingPreference {
    if (!groupId) {
      throw new Error("Missing Group id.");
    }

    const file = this.read();
    const groups = file.groups ?? {};
    const saved = normalizeGroupGamingPreference({
      ...groups[groupId],
      ...preference
    });
    groups[groupId] = saved;
    this.write({ ...file, groups });
    return saved;
  }

  private read(): GroupGamingPreferenceFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as GroupGamingPreferenceFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: GroupGamingPreferenceFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(sortPreferenceFile(file), null, 2)}\n`, "utf8");
  }
}

export function groupGamingPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "game-groups.json");
}

export function normalizeGroupGamingPreference(
  preference: Partial<GroupGamingPreference> | undefined
): GroupGamingPreference {
  const campaignId = optionalText(preference?.campaignId);
  const mysteryId = optionalText(preference?.mysteryId);
  return {
    enabled: preference?.enabled === true,
    ...(campaignId ? { campaignId } : {}),
    ...(mysteryId ? { mysteryId } : {}),
    automationMode: normalizeAutomationMode(preference?.automationMode)
  };
}

function normalizeAutomationMode(value: unknown): GamingAutomationMode {
  if (value === "suggest" || value === "supervised") {
    return "suggest";
  }
  return value === "autonomous" ? value : "observe";
}

function optionalText(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function sortPreferenceFile(file: GroupGamingPreferenceFile): GroupGamingPreferenceFile {
  const groups = Object.fromEntries(
    Object.entries(file.groups ?? {}).sort(([left], [right]) => left.localeCompare(right))
  );
  return { groups };
}
