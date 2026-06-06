#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config/loadConfig.js";
import { generateElevenLabsSound } from "../../src/soundscapeGeneration/elevenLabsProvider.js";
import {
  catalogEntryFromPlanItem,
  createGenerationPlan,
  emptyGeneratedCatalog,
  ensureSoundscapeAssetDirs,
  extensionFromContentType,
  fileHash,
  generatedFileName,
  readGeneratedCatalog,
  upsertCatalogEntry,
  validatePaletteDefinition,
  writeJsonAtomic,
  type GeneratedSoundscapeCatalog
} from "../../src/soundscapeGeneration/palette.js";

interface CliOptions {
  dryRun: boolean;
  force: boolean;
  failFast: boolean;
  only?: string;
  variants?: number;
  outDir: string;
  configPath?: string;
  definitionPath: string;
  model?: string;
  outputFormat?: string;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const palette = validatePaletteDefinition(JSON.parse(fs.readFileSync(options.definitionPath, "utf8")) as unknown);
  const catalogPath = path.join(options.outDir, "catalog.generated.json");
  const existingCatalog = readGeneratedCatalog(catalogPath);
  const plan = createGenerationPlan(palette, {
    outDir: options.outDir,
    existingCatalog,
    force: options.force,
    only: options.only,
    variantsOverride: options.variants,
    model: options.model ?? process.env.ELEVENLABS_MODEL_ID,
    outputFormat: options.outputFormat ?? process.env.ELEVENLABS_OUTPUT_FORMAT
  });

  printPlan(plan.length, plan.filter((item) => item.skipped).length, options);
  for (const item of plan) {
    const action = item.skipped ? "skip" : options.dryRun ? "plan" : "generate";
    console.log(`${action}: ${item.item.id} v${item.variant} -> ${path.relative(process.cwd(), item.outputPath)}`);
  }

  if (options.dryRun) {
    return;
  }

  const apiKey = resolveElevenLabsApiKey(options.configPath);
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY or configured voice.elevenlabs.apiKey is required unless --dry-run is used.");
  }

  ensureSoundscapeAssetDirs(options.outDir);
  let catalog: GeneratedSoundscapeCatalog =
    existingCatalog.entries.length > 0 ? existingCatalog : emptyGeneratedCatalog();
  const generatedAt = new Date().toISOString();
  const failures: string[] = [];

  for (const item of plan) {
    if (item.skipped) {
      continue;
    }

    try {
      const result = await generateElevenLabsSound({
        apiKey,
        item: item.item,
        model: item.model,
        outputFormat: item.outputFormat
      });
      const extension = extensionFromContentType(result.contentType, item.outputFormat);
      const variantCount = options.variants ?? item.item.variants ?? 1;
      const expectedPath = path.join(
        options.outDir,
        item.item.kind === "loop" ? "loops" : "cues",
        generatedFileName(item.item.id, variantCount > 1 ? item.variant : null, extension)
      );
      fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
      const tempPath = `${expectedPath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, result.bytes);
      fs.renameSync(tempPath, expectedPath);

      const finalPlanItem = {
        ...item,
        outputPath: expectedPath,
        assetKey: `soundscape/${item.item.kind === "loop" ? "loops" : "cues"}/${path.basename(expectedPath)}`
      };
      catalog = upsertCatalogEntry(
        catalog,
        catalogEntryFromPlanItem(finalPlanItem, generatedAt, fileHash(expectedPath))
      );
      writeJsonAtomic(catalogPath, catalog);
      console.log(`wrote: ${path.relative(process.cwd(), expectedPath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${item.item.id} v${item.variant}: ${message}`);
      console.warn(`failed: ${item.item.id} v${item.variant}: ${message}`);
      if (options.failFast) {
        break;
      }
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    console.warn(`Completed with ${failures.length} failure(s).`);
  }
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    force: false,
    failFast: false,
    outDir: path.resolve(process.cwd(), ".local", "soundscape", "raw"),
    definitionPath: path.resolve(process.cwd(), "scripts", "soundscape", "soundscape-palette.definition.json")
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--fail-fast":
        options.failFast = true;
        break;
      case "--only":
        options.only = requiredValue(args, ++index, arg);
        break;
      case "--variants":
        options.variants = positiveInteger(requiredValue(args, ++index, arg), "--variants");
        break;
      case "--out-dir":
        options.outDir = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--config":
        options.configPath = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--definition":
        options.definitionPath = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--model":
        options.model = requiredValue(args, ++index, arg);
        break;
      case "--output-format":
        options.outputFormat = requiredValue(args, ++index, arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function resolveElevenLabsApiKey(configPath: string | undefined): string {
  const envKey = process.env.ELEVENLABS_API_KEY || process.env.KINAGENT_ELEVENLABS_API_KEY;
  if (envKey?.trim()) {
    return envKey.trim();
  }
  return loadConfig({ configPath }).voice.elevenlabs.apiKey.trim();
}

function printPlan(total: number, skipped: number, options: CliOptions): void {
  console.log(
    `soundscape palette: ${total} planned item(s), ${skipped} skipped, mode=${options.dryRun ? "dry-run" : "generate"}`
  );
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
