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
  content: string;
  summary: string;
  addedLines: number;
  removedLines: number;
  characterDelta: number;
  changed: boolean;
  previousShortHash?: string;
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

type RawCaptureHistoryEntry = Pick<CaptureHistoryEntry, "hash" | "shortHash" | "committedAt" | "subject">;

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
      history: await fileHistory(captureRoot, workspaceRoot, markdownPath, "markdown")
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
    history: await fileHistory(captureRoot, workspaceRoot, filePath, "json")
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
    history: await fileHistory(captureRoot, workspaceRoot, filePath, "journal")
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
  filePath: string,
  kind: CapturedKinFieldView["kind"]
): Promise<CaptureHistoryEntry[]> {
  const relativePath = toGitPath(path.relative(captureRoot, filePath));
  const workspaceRelativePath = toGitPath(path.relative(workspaceRoot, filePath));

  try {
    const result = await execFileAsync(
      "git",
      ["log", "--follow", "--pretty=format:%H%x09%h%x09%cI%x09%s", "--", relativePath],
      { cwd: captureRoot, maxBuffer: 1024 * 1024, timeout: 5_000, windowsHide: true }
    );
    const entries = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseHistoryLine)
      .filter((entry): entry is RawCaptureHistoryEntry => Boolean(entry));
    return enrichHistoryEntries(captureRoot, relativePath, entries, kind);
  } catch {
    try {
      const workspaceGitRoot = path.join(captureRoot, "workspace");
      const result = await execFileAsync(
        "git",
        ["log", "--follow", "--pretty=format:%H%x09%h%x09%cI%x09%s", "--", workspaceRelativePath],
        { cwd: workspaceGitRoot, maxBuffer: 1024 * 1024, timeout: 5_000, windowsHide: true }
      );
      const entries = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseHistoryLine)
        .filter((entry): entry is RawCaptureHistoryEntry => Boolean(entry));
      return enrichHistoryEntries(workspaceGitRoot, workspaceRelativePath, entries, kind);
    } catch {
      return [];
    }
  }
}

async function enrichHistoryEntries(
  cwd: string,
  gitPath: string,
  entries: RawCaptureHistoryEntry[],
  kind: CapturedKinFieldView["kind"]
): Promise<CaptureHistoryEntry[]> {
  const contents = await Promise.all(entries.map((entry) => readFileAtCommit(cwd, entry.hash, gitPath)));

  return entries.map((entry, index) => {
    const content = contents[index] ?? "";
    const previousContent = contents[index + 1] ?? "";
    const stats = lineDiffStats(previousContent, content);

    return {
      ...entry,
      content,
      summary: summarizeHistoryContent(content, kind),
      ...stats,
      previousShortHash: entries[index + 1]?.shortHash
    };
  });
}

async function readFileAtCommit(cwd: string, hash: string, gitPath: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["show", `${hash}:${gitPath}`], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5_000,
      windowsHide: true
    });
    return result.stdout;
  } catch {
    return "";
  }
}

function parseHistoryLine(line: string): RawCaptureHistoryEntry | null {
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

function summarizeHistoryContent(content: string, kind: CapturedKinFieldView["kind"]): string {
  if (!content.trim()) {
    return "Empty captured value";
  }

  if (kind === "json") {
    try {
      const value = JSON.parse(content) as unknown;
      if (Array.isArray(value)) {
        return `${value.length} captured item${value.length === 1 ? "" : "s"}`;
      }
      if (value && typeof value === "object") {
        const keys = Object.keys(value);
        return `${keys.length} captured field${keys.length === 1 ? "" : "s"}`;
      }
    } catch {
      // Fall through to text summary.
    }
  }

  if (kind === "journal") {
    try {
      const entries = JSON.parse(content) as unknown;
      if (Array.isArray(entries)) {
        return `${entries.length} journal entr${entries.length === 1 ? "y" : "ies"}`;
      }
    } catch {
      // Fall through to text summary.
    }
  }

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#+\s*/, ""))
    .find(Boolean);

  return truncate(firstLine || "Captured value", 120);
}

function lineDiffStats(previousContent: string, currentContent: string) {
  const previousLines = splitDiffLines(previousContent);
  const currentLines = splitDiffLines(currentContent);
  const commonLineCount = lcsLength(previousLines, currentLines);

  return {
    addedLines: Math.max(0, currentLines.length - commonLineCount),
    removedLines: Math.max(0, previousLines.length - commonLineCount),
    characterDelta: currentContent.length - previousContent.length,
    changed: previousContent !== currentContent
  };
}

function splitDiffLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
}

function lcsLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  if (left.length * right.length > 250_000) {
    const rightCounts = new Map<string, number>();
    for (const line of right) {
      rightCounts.set(line, (rightCounts.get(line) ?? 0) + 1);
    }

    let overlap = 0;
    for (const line of left) {
      const count = rightCounts.get(line) ?? 0;
      if (count > 0) {
        overlap += 1;
        rightCounts.set(line, count - 1);
      }
    }
    return overlap;
  }

  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);

  for (const leftLine of left) {
    for (let index = 0; index < right.length; index += 1) {
      current[index + 1] =
        leftLine === right[index] ? previous[index] + 1 : Math.max(previous[index + 1], current[index]);
    }
    [previous, current] = [current, previous.fill(0)];
  }

  return previous[right.length];
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
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
