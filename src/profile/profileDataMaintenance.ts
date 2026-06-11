import fs from "node:fs";
import path from "node:path";
import { storageStatePath } from "../auth/tokenStore.js";
import { ChatDynamismSuggestionStore } from "../chatDynamism/chatDynamismSuggestionStore.js";
import type { AppConfig } from "../config/types.js";
import { GroupBackgroundSuggestionStore } from "../groupBackground/groupBackgroundSuggestionStore.js";
import { JournalSuggestionStore } from "../journal/journalSuggestionStore.js";

export interface ProfileDataCategory {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
}

export interface ProfileDataReport {
  userDataDir: string;
  dataDir: string;
  totalBytes: number;
  totalFiles: number;
  categories: ProfileDataCategory[];
}

export interface ProfileDataPruneResult {
  ok: true;
  journalSuggestionsRemoved: number;
  groupBackgroundSuggestionsRemoved: number;
  chatDynamismSuggestionsRemoved: number;
  orphanedGroupBackgroundImagesRemoved: number;
  report: ProfileDataReport;
}

const cacheDirectoryNames = ["Cache", "Code Cache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GPUCache"];

export function profileDataReport(config: AppConfig, userDataDir: string, configPath?: string): ProfileDataReport {
  const dataDir = path.dirname(path.resolve(config.bridge.sqlitePath));
  const total = summarizePath(userDataDir);
  const categories: ProfileDataCategory[] = [
    category("config", "Config", configPath ? path.resolve(configPath) : path.join(userDataDir, "config.yaml")),
    category("logs", "Logs", path.resolve(config.bridge.logPath)),
    category("browserSession", "Saved Kindroid session", path.resolve(config.bridge.sessionDir)),
    category("sqlite", "Dedupe database", path.resolve(config.bridge.sqlitePath)),
    category("reviewHistory", "Review history", dataDir, [
      "journal-suggestions.json",
      "group-background-suggestions.json",
      "chat-dynamism-suggestions.json"
    ]),
    category("generatedImages", "Generated background images", path.join(dataDir, "group-background-images")),
    category("captureHistory", "Captured Kin history", path.join(dataDir, "kin-source-control")),
    category("captureHistoryVault", "Captured Kin history vault", path.join(dataDir, "kin-source-control.vault")),
    category("electronCaches", "Electron caches", userDataDir, cacheDirectoryNames)
  ];
  return {
    userDataDir,
    dataDir,
    totalBytes: total.bytes,
    totalFiles: total.files,
    categories
  };
}

export function pruneProfileData(config: AppConfig, userDataDir: string): ProfileDataPruneResult {
  const journal = JournalSuggestionStore.fromConfig(config).pruneCompleted();
  const backgrounds = GroupBackgroundSuggestionStore.fromConfig(config).pruneCompleted();
  const chatDynamism = ChatDynamismSuggestionStore.fromConfig(config).pruneCompleted();
  const orphanedImagesRemoved = cleanupOrphanedGroupBackgroundImages(config);
  return {
    ok: true,
    journalSuggestionsRemoved: journal.removed,
    groupBackgroundSuggestionsRemoved: backgrounds.removed,
    chatDynamismSuggestionsRemoved: chatDynamism.removed,
    orphanedGroupBackgroundImagesRemoved: orphanedImagesRemoved,
    report: profileDataReport(config, userDataDir)
  };
}

export function clearSavedBrowserSession(config: AppConfig): { ok: true; removed: boolean; path: string } {
  const sessionDir = path.resolve(config.bridge.sessionDir);
  const existed = fs.existsSync(sessionDir);
  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return {
    ok: true,
    removed: existed || fs.existsSync(storageStatePath(sessionDir)),
    path: sessionDir
  };
}

export function clearElectronCaches(userDataDir: string): { ok: true; removedBytes: number; removedFiles: number } {
  let removedBytes = 0;
  let removedFiles = 0;
  for (const name of cacheDirectoryNames) {
    const cachePath = safeProfileChildPath(userDataDir, name);
    const summary = summarizePath(cachePath);
    removedBytes += summary.bytes;
    removedFiles += summary.files;
    fs.rmSync(cachePath, { recursive: true, force: true });
  }
  return { ok: true, removedBytes, removedFiles };
}

function category(key: string, label: string, rootPath: string, childNames?: string[]): ProfileDataCategory {
  if (!childNames) {
    const summary = summarizePath(rootPath);
    return {
      key,
      label,
      path: rootPath,
      exists: summary.exists,
      bytes: summary.bytes,
      files: summary.files
    };
  }

  const summaries = childNames.map((name) => summarizePath(path.join(rootPath, name)));
  return {
    key,
    label,
    path: rootPath,
    exists: summaries.some((summary) => summary.exists),
    bytes: summaries.reduce((sum, summary) => sum + summary.bytes, 0),
    files: summaries.reduce((sum, summary) => sum + summary.files, 0)
  };
}

function summarizePath(targetPath: string): { exists: boolean; bytes: number; files: number } {
  try {
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      return { exists: true, bytes: 0, files: 0 };
    }
    if (stats.isFile()) {
      return { exists: true, bytes: stats.size, files: 1 };
    }
    if (!stats.isDirectory()) {
      return { exists: true, bytes: 0, files: 0 };
    }

    let bytes = 0;
    let files = 0;
    for (const entry of fs.readdirSync(targetPath)) {
      const child = summarizePath(path.join(targetPath, entry));
      bytes += child.bytes;
      files += child.files;
    }
    return { exists: true, bytes, files };
  } catch {
    return { exists: false, bytes: 0, files: 0 };
  }
}

function cleanupOrphanedGroupBackgroundImages(config: AppConfig): number {
  const dataDir = path.dirname(path.resolve(config.bridge.sqlitePath));
  const imagesDir = path.join(dataDir, "group-background-images");
  if (!fs.existsSync(imagesDir)) {
    return 0;
  }

  const store = GroupBackgroundSuggestionStore.fromConfig(config);
  const referenced = new Set(
    store
      .list()
      .flatMap((suggestion) => [suggestion.generatedImage?.path, suggestion.appliedBackgroundPath])
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value))
  );
  let removed = 0;
  for (const entry of fs.readdirSync(imagesDir)) {
    const imagePath = path.resolve(imagesDir, entry);
    if (!imagePath.startsWith(`${path.resolve(imagesDir)}${path.sep}`) || referenced.has(imagePath)) {
      continue;
    }
    const stats = fs.lstatSync(imagePath);
    if (!stats.isFile()) {
      continue;
    }
    fs.rmSync(imagePath, { force: true });
    removed += 1;
  }
  return removed;
}

function safeProfileChildPath(userDataDir: string, childName: string): string {
  const base = path.resolve(userDataDir);
  const targetPath = path.resolve(base, childName);
  if (targetPath !== base && targetPath.startsWith(`${base}${path.sep}`)) {
    return targetPath;
  }
  throw new Error("Refusing to clean a path outside the profile.");
}
