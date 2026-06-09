import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";

export interface GroupBackgroundPreference {
  enabled: boolean;
  autonomous: boolean;
}

interface GroupBackgroundPreferenceFile {
  groups?: Record<string, GroupBackgroundPreference>;
}

export class GroupBackgroundPreferenceStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: GroupBackgroundPreference
  ) {}

  static fromConfig(config: AppConfig): GroupBackgroundPreferenceStore {
    return new GroupBackgroundPreferenceStore(groupBackgroundPreferencesPath(config), {
      enabled: config.hermes.groupBackgrounds.suggestions.enabled,
      autonomous:
        config.hermes.groupBackgrounds.suggestions.enabled && config.hermes.groupBackgrounds.suggestions.autonomous
    });
  }

  get(groupId: string): GroupBackgroundPreference {
    return normalizeGroupBackgroundPreference(this.read().groups?.[groupId], this.defaults);
  }

  set(groupId: string, preference: Partial<GroupBackgroundPreference>): GroupBackgroundPreference {
    if (!groupId) {
      throw new Error("Missing Group id.");
    }

    const file = this.read();
    const groups = file.groups ?? {};
    const saved = normalizeGroupBackgroundPreference(
      {
        ...groups[groupId],
        ...preference
      },
      this.defaults
    );
    groups[groupId] = saved;
    this.write({ ...file, groups });
    return saved;
  }

  private read(): GroupBackgroundPreferenceFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as GroupBackgroundPreferenceFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: GroupBackgroundPreferenceFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(sortPreferenceFile(file), null, 2)}\n`, "utf8");
  }
}

export function groupBackgroundPreferencesPath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "group-backgrounds.json");
}

export function normalizeGroupBackgroundPreference(
  preference: Partial<GroupBackgroundPreference> | undefined,
  defaults: GroupBackgroundPreference = { enabled: false, autonomous: false }
): GroupBackgroundPreference {
  const enabled = typeof preference?.enabled === "boolean" ? preference.enabled : defaults.enabled;
  const autonomous = typeof preference?.autonomous === "boolean" ? preference.autonomous : defaults.autonomous;
  return {
    enabled,
    autonomous: enabled && autonomous
  };
}

function sortPreferenceFile(file: GroupBackgroundPreferenceFile): GroupBackgroundPreferenceFile {
  const groups = Object.fromEntries(
    Object.entries(file.groups ?? {}).sort(([left], [right]) => left.localeCompare(right))
  );
  return { groups };
}
