import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { ScopedSoundscapeUpdate } from "../hermes/soundscapeActionHandler.js";

export interface StoredSoundscapeUpdate extends ScopedSoundscapeUpdate {
  updatedAt: string;
}

interface SoundscapeStateFile {
  states?: Record<string, StoredSoundscapeUpdate>;
}

export class SoundscapeStateStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): SoundscapeStateStore {
    return new SoundscapeStateStore(soundscapeStatePath(config));
  }

  list(): StoredSoundscapeUpdate[] {
    return Object.values(this.read().states ?? {}).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getForKin(kinId: string): StoredSoundscapeUpdate | null {
    return this.read().states?.[soundscapeKey("kin", kinId)] ?? null;
  }

  getForGroup(groupId: string): StoredSoundscapeUpdate | null {
    return this.read().states?.[soundscapeKey("group", groupId)] ?? null;
  }

  update(input: ScopedSoundscapeUpdate): StoredSoundscapeUpdate | null {
    const key = soundscapeKeyForUpdate(input);
    if (!key) {
      return null;
    }

    const file = this.read();
    const states = file.states ?? {};
    const next: StoredSoundscapeUpdate = {
      ...input,
      updatedAt: new Date().toISOString()
    };
    states[key] = next;
    this.write({ ...file, states });
    return next;
  }

  deleteForKin(kinId: string): void {
    this.delete(soundscapeKey("kin", kinId));
  }

  deleteForGroup(groupId: string): void {
    this.delete(soundscapeKey("group", groupId));
  }

  private delete(key: string): void {
    const file = this.read();
    const states = file.states ?? {};
    delete states[key];
    this.write({ ...file, states });
  }

  private read(): SoundscapeStateFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SoundscapeStateFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: SoundscapeStateFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function soundscapeStatePath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "soundscape-state.json");
}

function soundscapeKey(scope: "kin" | "group", id: string): string {
  return `${scope}:${id}`;
}

function soundscapeKeyForUpdate(update: ScopedSoundscapeUpdate): string | null {
  if (update.scope === "kin" && update.kinId) {
    return soundscapeKey("kin", update.kinId);
  }
  if (update.scope === "group" && update.groupId) {
    return soundscapeKey("group", update.groupId);
  }
  return null;
}
