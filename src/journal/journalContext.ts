import fs from "node:fs/promises";
import path from "node:path";
import { defaultCaptureOutputDir } from "../capture/kinStateCapture.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import type { Logger } from "../util/logger.js";

export interface ExistingJournalEntry {
  title: string;
  entry: string;
  keyphrases: string[];
}

export interface CapturedFieldExcerpt {
  field: string;
  value: string;
}

export interface JournalSuggestionContext {
  existingEntries: ExistingJournalEntry[];
  fieldExcerpts: CapturedFieldExcerpt[];
}

interface CapturedJournalEntry {
  id?: unknown;
  fields?: Record<string, { value?: unknown }>;
}

interface CapturedProfile {
  id?: unknown;
}

const excerptFields = [
  ["ai_backstory", "Backstory"],
  ["ai_memory", "Key Memories"],
  ["ai_directive", "Response Directive"]
] as const;

export function createCapturedJournalContextProvider(logger: Logger) {
  return async (notification: KindroidChatNotification): Promise<JournalSuggestionContext> => {
    const aiId = aiIdFromNotification(notification);
    if (!aiId) {
      return emptyContext();
    }

    try {
      return await readCapturedJournalContext(aiId);
    } catch (error) {
      logger.debug("Captured journal context unavailable.", {
        aiId,
        error: error instanceof Error ? error.message : String(error)
      });
      return emptyContext();
    }
  };
}

async function readCapturedJournalContext(aiId: string): Promise<JournalSuggestionContext> {
  const captureRoot = path.resolve(process.cwd(), defaultCaptureOutputDir);
  const workspaceRoot = path.join(captureRoot, "workspace");
  const kinDir = await findKinCaptureDir(workspaceRoot, sanitizeId(aiId));
  if (!kinDir) {
    return emptyContext();
  }

  const [existingEntries, fieldExcerpts] = await Promise.all([readExistingEntries(kinDir), readFieldExcerpts(kinDir)]);
  return { existingEntries, fieldExcerpts };
}

async function findKinCaptureDir(workspaceRoot: string, aiId: string): Promise<string | null> {
  const kinsRoot = resolveInside(workspaceRoot, "kins");
  const entries = await fs.readdir(kinsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = resolveInside(kinsRoot, entry.name);
    if (entry.name.endsWith(`--${aiId}`)) {
      return candidate;
    }

    const profile = await readJson<CapturedProfile>(resolveInside(candidate, "profile.json"));
    if (profile?.id === aiId) {
      return candidate;
    }
  }

  return null;
}

async function readExistingEntries(kinDir: string): Promise<ExistingJournalEntry[]> {
  const entries = (await readJson<CapturedJournalEntry[]>(resolveInside(kinDir, "journal", "entries.json"))) ?? [];
  return entries
    .map((entry) => {
      const fields = entry.fields ?? {};
      return {
        title: typeof entry.id === "string" ? entry.id : "Journal entry",
        entry: stringValue(fields.entry?.value),
        keyphrases: Array.isArray(fields.keyphrases?.value)
          ? fields.keyphrases.value.map((item) => String(item)).filter(Boolean)
          : []
      };
    })
    .filter((entry) => entry.entry)
    .slice(0, 12);
}

async function readFieldExcerpts(kinDir: string): Promise<CapturedFieldExcerpt[]> {
  const excerpts = await Promise.all(
    excerptFields.map(async ([fileName, label]): Promise<CapturedFieldExcerpt | null> => {
      const value = await readTextExcerpt(resolveInside(kinDir, "fields", `${fileName}.md`));
      return value ? { field: label, value } : null;
    })
  );
  return excerpts.filter((excerpt): excerpt is CapturedFieldExcerpt => Boolean(excerpt));
}

async function readTextExcerpt(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const normalized = raw.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 700) : null;
  } catch {
    return null;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function emptyContext(): JournalSuggestionContext {
  return { existingEntries: [], fieldExcerpts: [] };
}

function aiIdFromNotification(notification: KindroidChatNotification): string | null {
  return notification.type === "kindroid.chat.changed" ? notification.kinId || null : notification.aiId || null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
