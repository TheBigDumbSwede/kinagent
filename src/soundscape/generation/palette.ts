import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PaletteCategory = "ambience" | "foley" | "murmur" | "mechanical" | "weather" | "object" | "misc";
export type PaletteKind = "loop" | "oneShot";
export type PaletteProvider = "elevenlabs";

export interface SoundscapePaletteItem {
  id: string;
  category: PaletteCategory;
  kind: PaletteKind;
  prompt: string;
  durationSeconds: number;
  loop: boolean;
  tags: string[];
  moodTags: string[];
  environmentTags: string[];
  volumeDefault: number;
  intensityMin: number;
  intensityMax: number;
  cooldownMs?: number;
  probability?: number;
  variants?: number;
  outputFormat?: string;
  provider: PaletteProvider;
  model?: string;
  license: "elevenlabs-generated";
  attribution?: string;
  notes?: string;
}

export interface SoundscapePaletteDefinition {
  version: number;
  items: SoundscapePaletteItem[];
}

export interface GeneratedSoundscapeCatalogEntry {
  id: string;
  category: PaletteCategory;
  kind: PaletteKind;
  tags: string[];
  moodTags: string[];
  environmentTags: string[];
  assetKey: string;
  durationSeconds: number;
  loop: boolean;
  volumeDefault: number;
  intensityMin: number;
  intensityMax: number;
  cooldownMs?: number;
  probability?: number;
  provider: PaletteProvider;
  model: string;
  license: string;
  attribution?: string;
  prompt: string;
  generatedAt: string;
  sourceHash: string;
  fileHash?: string;
  variant: number;
  analysis?: {
    status: "dead" | "weak" | "ok" | "hot";
    reasons: string[];
    peakDb: number;
    rmsDb: number;
    maxWindowRmsDb: number;
    activePercent: number;
    nearZeroPercent: number;
    recommendedGainDb: number;
    analyzedAt: string;
  };
}

export interface GeneratedSoundscapeCatalog {
  version: number;
  generatedAt: string | null;
  entries: GeneratedSoundscapeCatalogEntry[];
}

export interface GenerationPlanOptions {
  outDir: string;
  existingCatalog?: GeneratedSoundscapeCatalog;
  force?: boolean;
  only?: string;
  variantsOverride?: number;
  model?: string;
  outputFormat?: string;
}

export interface GenerationPlanItem {
  item: SoundscapePaletteItem;
  variant: number;
  sourceHash: string;
  outputPath: string;
  assetKey: string;
  model: string;
  outputFormat: string;
  skipped: boolean;
  skipReason?: string;
}

const maxDurationSeconds = 30;
const defaultModel = "eleven_text_to_sound_v2";
const defaultOutputFormat = "mp3_44100_128";

const categories = new Set<PaletteCategory>(["ambience", "foley", "murmur", "mechanical", "weather", "object", "misc"]);
const kinds = new Set<PaletteKind>(["loop", "oneShot"]);

export function validatePaletteDefinition(value: unknown): SoundscapePaletteDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Palette definition must be an object.");
  }
  const record = value as Record<string, unknown>;
  const version = numberField(record, "version", { integer: true, min: 1 });
  if (!Array.isArray(record.items)) {
    throw new Error("Palette definition requires items array.");
  }

  const seen = new Set<string>();
  const items = record.items.map((item, index) => {
    const normalized = validatePaletteItem(item, index);
    if (seen.has(normalized.id)) {
      throw new Error(`Palette item id is duplicated: ${normalized.id}`);
    }
    seen.add(normalized.id);
    return normalized;
  });

  return { version, items };
}

export function validatePaletteItem(value: unknown, index = 0): SoundscapePaletteItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Palette item ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const id = stringField(record, "id");
  if (!/^[a-z0-9][a-z0-9_]*$/.test(id)) {
    throw new Error(`Palette item ${id} has invalid id.`);
  }
  const category = enumField(record, "category", categories);
  const kind = enumField(record, "kind", kinds);
  const durationSeconds = numberField(record, "durationSeconds", { min: 0.5, max: maxDurationSeconds });
  const loop = booleanField(record, "loop");
  const provider = enumField(record, "provider", new Set<PaletteProvider>(["elevenlabs"]));
  const license = enumField(record, "license", new Set(["elevenlabs-generated"] as const));
  const intensityMin = numberField(record, "intensityMin", { min: 0, max: 1 });
  const intensityMax = numberField(record, "intensityMax", { min: 0, max: 1 });
  if (intensityMin > intensityMax) {
    throw new Error(`Palette item ${id} intensityMin cannot exceed intensityMax.`);
  }

  return {
    id,
    category,
    kind,
    prompt: stringField(record, "prompt"),
    durationSeconds,
    loop,
    tags: stringArrayField(record, "tags"),
    moodTags: stringArrayField(record, "moodTags"),
    environmentTags: stringArrayField(record, "environmentTags"),
    volumeDefault: numberField(record, "volumeDefault", { min: 0, max: 1 }),
    intensityMin,
    intensityMax,
    cooldownMs: optionalNumberField(record, "cooldownMs", { min: 0, integer: true }),
    probability: optionalNumberField(record, "probability", { min: 0, max: 1 }),
    variants: optionalNumberField(record, "variants", { min: 1, max: 12, integer: true }),
    outputFormat: optionalStringField(record, "outputFormat"),
    provider,
    model: optionalStringField(record, "model"),
    license,
    attribution: optionalStringField(record, "attribution"),
    notes: optionalStringField(record, "notes")
  };
}

export function createGenerationPlan(
  definition: SoundscapePaletteDefinition,
  options: GenerationPlanOptions
): GenerationPlanItem[] {
  const existingEntries = new Map(
    (options.existingCatalog?.entries ?? []).map((entry) => [`${entry.id}:${entry.variant}`, entry])
  );
  const items = options.only ? definition.items.filter((item) => item.id === options.only) : definition.items;
  if (options.only && items.length === 0) {
    throw new Error(`Palette item not found: ${options.only}`);
  }

  return items.flatMap((item) => {
    const variantCount = Math.max(1, options.variantsOverride ?? item.variants ?? 1);
    return Array.from({ length: variantCount }, (_, index) => {
      const variant = index + 1;
      const model = options.model ?? item.model ?? defaultModel;
      const outputFormat = options.outputFormat ?? item.outputFormat ?? defaultOutputFormat;
      const extension = extensionFromOutputFormat(outputFormat);
      const fileName = generatedFileName(item.id, variantCount > 1 ? variant : null, extension);
      const relativeFolder = item.kind === "loop" ? "loops" : "cues";
      const outputPath = path.join(options.outDir, relativeFolder, fileName);
      const assetKey = `soundscape/${relativeFolder}/${fileName}`;
      const sourceHash = paletteSourceHash(item, { model, outputFormat });
      const existingEntry = existingEntries.get(`${item.id}:${variant}`);
      const fileExists = fs.existsSync(outputPath);
      const skipped = !options.force && fileExists && existingEntry?.sourceHash === sourceHash;
      return {
        item,
        variant,
        sourceHash,
        outputPath,
        assetKey,
        model,
        outputFormat,
        skipped,
        skipReason: skipped ? "Existing file and catalog source hash match." : undefined
      };
    });
  });
}

export function catalogEntryFromPlanItem(
  plan: GenerationPlanItem,
  generatedAt: string,
  fileHash?: string
): GeneratedSoundscapeCatalogEntry {
  return {
    id: plan.item.id,
    category: plan.item.category,
    kind: plan.item.kind,
    tags: [...plan.item.tags],
    moodTags: [...plan.item.moodTags],
    environmentTags: [...plan.item.environmentTags],
    assetKey: plan.assetKey,
    durationSeconds: plan.item.durationSeconds,
    loop: plan.item.loop,
    volumeDefault: plan.item.volumeDefault,
    intensityMin: plan.item.intensityMin,
    intensityMax: plan.item.intensityMax,
    cooldownMs: plan.item.cooldownMs,
    probability: plan.item.probability,
    provider: plan.item.provider,
    model: plan.model,
    license: plan.item.license,
    attribution: plan.item.attribution,
    prompt: plan.item.prompt,
    generatedAt,
    sourceHash: plan.sourceHash,
    fileHash,
    variant: plan.variant
  };
}

export function upsertCatalogEntry(
  catalog: GeneratedSoundscapeCatalog,
  entry: GeneratedSoundscapeCatalogEntry
): GeneratedSoundscapeCatalog {
  const entries = catalog.entries.filter(
    (existing) => !(existing.id === entry.id && existing.variant === entry.variant)
  );
  entries.push(entry);
  entries.sort((left, right) => `${left.id}:${left.variant}`.localeCompare(`${right.id}:${right.variant}`));
  return {
    version: catalog.version,
    generatedAt: entry.generatedAt,
    entries
  };
}

export function emptyGeneratedCatalog(): GeneratedSoundscapeCatalog {
  return { version: 1, generatedAt: null, entries: [] };
}

export function generatedFileName(id: string, variant: number | null, extension: string): string {
  const safeId = id
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeExtension = extension.replace(/^\./, "").toLowerCase() || "mp3";
  return variant ? `${safeId}_v${variant}.${safeExtension}` : `${safeId}.${safeExtension}`;
}

export function extensionFromOutputFormat(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) {
    return "mp3";
  }
  if (outputFormat.startsWith("pcm_")) {
    return "pcm";
  }
  if (outputFormat.startsWith("ulaw_")) {
    return "ulaw";
  }
  return "mp3";
}

export function extensionFromContentType(contentType: string | null, fallbackOutputFormat: string): string {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }
  return extensionFromOutputFormat(fallbackOutputFormat);
}

export function paletteSourceHash(
  item: SoundscapePaletteItem,
  options: { model: string; outputFormat: string }
): string {
  return sha256(
    JSON.stringify({
      prompt: item.prompt,
      durationSeconds: item.durationSeconds,
      loop: item.loop,
      provider: item.provider,
      model: options.model,
      outputFormat: options.outputFormat
    })
  );
}

export function fileHash(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

export function readGeneratedCatalog(catalogPath: string): GeneratedSoundscapeCatalog {
  if (!fs.existsSync(catalogPath)) {
    return emptyGeneratedCatalog();
  }
  const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    return emptyGeneratedCatalog();
  }
  return parsed as GeneratedSoundscapeCatalog;
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function ensureSoundscapeAssetDirs(outDir: string): void {
  fs.mkdirSync(path.join(outDir, "loops"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "cues"), { recursive: true });
}

function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Palette item requires non-empty ${key}.`);
  }
  return value.trim();
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Palette item requires boolean ${key}.`);
  }
  return value;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Palette item requires numeric ${key}.`);
  }
  validateNumber(key, value, options);
  return value;
}

function optionalNumberField(
  record: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Palette item optional ${key} must be numeric.`);
  }
  validateNumber(key, value, options);
  return value;
}

function validateNumber(key: string, value: number, options: { min?: number; max?: number; integer?: boolean }): void {
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${key} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${key} must be at most ${options.max}.`);
  }
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) {
    throw new Error(`Palette item requires string array ${key}.`);
  }
  return [
    ...new Set(
      value.map((entry) =>
        entry
          .trim()
          .toLowerCase()
          .replace(/[\s_]+/g, "-")
      )
    )
  ].sort();
}

function enumField<T extends string>(record: Record<string, unknown>, key: string, allowed: Set<T>): T {
  const value = record[key];
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`Palette item ${key} must be one of ${[...allowed].join(", ")}.`);
  }
  return value as T;
}
