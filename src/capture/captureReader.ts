import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { defaultCaptureOutputDir } from "./kinStateCapture.js";

const execFileAsync = promisify(execFile);

const kinFieldTabs = [
  { key: "backstory", label: "Backstory", field: "ai_backstory" },
  { key: "directive", label: "Directive", field: "ai_directive" },
  { key: "memory", label: "Memory", field: "ai_memory" },
  { key: "example", label: "Example", field: "ai_example_message" },
  { key: "scene", label: "Current Scene", field: "current_scene" },
  { key: "background", label: "Background", field: "background_settings" },
  { key: "journal", label: "Journal", field: "journal" },
  { key: "profile", label: "Profile", field: "profile" }
] as const;

export type CapturedKinTabKey = (typeof kinFieldTabs)[number]["key"];

export interface CaptureHistoryEntry {
  hash: string;
  shortHash: string;
  committedAt: string;
  subject: string;
}

export interface CapturedKinFieldView {
  key: CapturedKinTabKey;
  label: string;
  available: boolean;
  kind: "markdown" | "json" | "journal" | "missing";
  content: string;
  history: CaptureHistoryEntry[];
}

export interface CapturedKinView {
  ok: boolean;
  outputDir: string;
  kinId: string;
  folderName?: string;
  fields: CapturedKinFieldView[];
  error?: string;
}

interface CapturedProfile {
  id?: unknown;
  fields?: unknown;
}

interface CapturedJournalEntry {
  id?: unknown;
  fields?: Record<string, CapturedField>;
}

interface CapturedField {
  value?: unknown;
}

export async function readCapturedKin(kinId: string, outputDir = defaultCaptureOutputDir): Promise<CapturedKinView> {
  const captureRoot = path.resolve(process.cwd(), outputDir);
  const workspaceRoot = path.join(captureRoot, "workspace");
  const safeKinId = sanitizeId(kinId);

  if (!safeKinId) {
    throw new Error("A Kin id is required.");
  }

  const kinDir = await findKinCaptureDir(workspaceRoot, safeKinId);
  if (!kinDir) {
    return {
      ok: false,
      outputDir: captureRoot,
      kinId: safeKinId,
      fields: emptyFieldViews(),
      error: "No captured state found for this Kin yet."
    };
  }

  const fields = await Promise.all(kinFieldTabs.map((tab) => readFieldView(captureRoot, workspaceRoot, kinDir, tab)));
  return {
    ok: true,
    outputDir: captureRoot,
    kinId: safeKinId,
    folderName: path.basename(kinDir),
    fields
  };
}

async function findKinCaptureDir(workspaceRoot: string, kinId: string): Promise<string | null> {
  const kinsRoot = resolveInside(workspaceRoot, "kins");
  let entries: Dirent<string>[];

  try {
    entries = await fs.readdir(kinsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = resolveInside(kinsRoot, entry.name);
    if (entry.name.endsWith(`--${kinId}`)) {
      return candidate;
    }

    const profile = await readJson<CapturedProfile>(resolveInside(candidate, "profile.json"));
    if (profile?.id === kinId) {
      return candidate;
    }
  }

  return null;
}

async function readFieldView(
  captureRoot: string,
  workspaceRoot: string,
  kinDir: string,
  tab: (typeof kinFieldTabs)[number]
): Promise<CapturedKinFieldView> {
  if (tab.field === "journal") {
    return readJournalView(captureRoot, workspaceRoot, kinDir, tab.key, tab.label);
  }

  if (tab.field === "profile") {
    const filePath = resolveInside(kinDir, "profile.json");
    return readJsonView(captureRoot, workspaceRoot, filePath, tab.key, tab.label);
  }

  const fieldsDir = resolveInside(kinDir, "fields");
  const markdownPath = resolveInside(fieldsDir, `${tab.field}.md`);
  const jsonPath = resolveInside(fieldsDir, `${tab.field}.json`);

  if (await exists(markdownPath)) {
    const content = await fs.readFile(markdownPath, "utf8");
    return {
      key: tab.key,
      label: tab.label,
      available: true,
      kind: "markdown",
      content,
      history: await fileHistory(captureRoot, workspaceRoot, markdownPath)
    };
  }

  if (await exists(jsonPath)) {
    return readJsonView(captureRoot, workspaceRoot, jsonPath, tab.key, tab.label);
  }

  return missingView(tab.key, tab.label);
}

async function readJsonView(
  captureRoot: string,
  workspaceRoot: string,
  filePath: string,
  key: CapturedKinTabKey,
  label: string
): Promise<CapturedKinFieldView> {
  if (!(await exists(filePath))) {
    return missingView(key, label);
  }

  const value = await readJson<unknown>(filePath);
  return {
    key,
    label,
    available: true,
    kind: "json",
    content: JSON.stringify(value, null, 2),
    history: await fileHistory(captureRoot, workspaceRoot, filePath)
  };
}

async function readJournalView(
  captureRoot: string,
  workspaceRoot: string,
  kinDir: string,
  key: CapturedKinTabKey,
  label: string
): Promise<CapturedKinFieldView> {
  const filePath = resolveInside(kinDir, "journal", "entries.json");
  if (!(await exists(filePath))) {
    return missingView(key, label);
  }

  const entries = (await readJson<CapturedJournalEntry[]>(filePath)) ?? [];
  const content =
    entries.length === 0 ? "No journal entries captured." : entries.map(formatJournalEntry).join("\n\n---\n\n");
  return {
    key,
    label,
    available: true,
    kind: "journal",
    content,
    history: await fileHistory(captureRoot, workspaceRoot, filePath)
  };
}

function formatJournalEntry(entry: CapturedJournalEntry): string {
  const fields = entry.fields ?? {};
  const title = typeof entry.id === "string" ? entry.id : "Journal entry";
  const created = valueAsString(fields.created?.value);
  const text = valueAsString(fields.entry?.value) ?? "";
  const keyphrases = Array.isArray(fields.keyphrases?.value)
    ? fields.keyphrases.value.map((item) => `- ${String(item)}`).join("\n")
    : "(none)";

  return [`# ${title}`, created ? `Created: ${created}` : null, "", text.trim(), "", "Keyphrases:", keyphrases]
    .filter((line) => line !== null)
    .join("\n");
}

async function fileHistory(
  captureRoot: string,
  workspaceRoot: string,
  filePath: string
): Promise<CaptureHistoryEntry[]> {
  const relativePath = toGitPath(path.relative(captureRoot, filePath));
  const workspaceRelativePath = toGitPath(path.relative(workspaceRoot, filePath));

  try {
    const result = await execFileAsync(
      "git",
      ["log", "--follow", "--pretty=format:%H%x09%h%x09%cI%x09%s", "--", relativePath],
      { cwd: captureRoot, maxBuffer: 1024 * 1024, timeout: 5_000, windowsHide: true }
    );
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseHistoryLine)
      .filter((entry): entry is CaptureHistoryEntry => Boolean(entry));
  } catch {
    try {
      const result = await execFileAsync(
        "git",
        ["log", "--follow", "--pretty=format:%H%x09%h%x09%cI%x09%s", "--", workspaceRelativePath],
        { cwd: path.join(captureRoot, "workspace"), maxBuffer: 1024 * 1024, timeout: 5_000, windowsHide: true }
      );
      return result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseHistoryLine)
        .filter((entry): entry is CaptureHistoryEntry => Boolean(entry));
    } catch {
      return [];
    }
  }
}

function parseHistoryLine(line: string): CaptureHistoryEntry | null {
  const [hash, shortHash, committedAt, ...subjectParts] = line.split("\t");
  if (!hash || !shortHash || !committedAt) {
    return null;
  }

  return {
    hash,
    shortHash,
    committedAt,
    subject: subjectParts.join("\t")
  };
}

function emptyFieldViews(): CapturedKinFieldView[] {
  return kinFieldTabs.map((tab) => missingView(tab.key, tab.label));
}

function missingView(key: CapturedKinTabKey, label: string): CapturedKinFieldView {
  return {
    key,
    label,
    available: false,
    kind: "missing",
    content: "",
    history: []
  };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^\w.-]/g, "");
}

function resolveInside(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escaped capture root: ${resolved}`);
  }

  return resolved;
}

function toGitPath(value: string): string {
  return value.split(path.sep).join("/");
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
