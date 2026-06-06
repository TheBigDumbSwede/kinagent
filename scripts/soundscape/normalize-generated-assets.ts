#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "../../src/soundscape/generation/palette.js";

interface SoundscapeAssetAnalysis {
  file: string;
  assetKey?: string;
  kind: "loop" | "oneShot";
  status: "dead" | "weak" | "ok" | "hot";
  peakDb: number;
  recommendedGainDb: number;
}

interface SoundscapeAnalysisReport {
  assets: SoundscapeAssetAnalysis[];
}

interface CliOptions {
  sourceDir: string;
  analysisPath: string;
  outDir: string;
  force: boolean;
  includeDead: boolean;
  ffmpegPath: string;
}

interface NormalizationEntry {
  source: string;
  output: string;
  kind: "loop" | "oneShot";
  status: "dead" | "weak" | "ok" | "hot";
  requestedGainDb: number;
  appliedGainDb: number;
  skipped: boolean;
}

export function parseArgs(args: string[]): CliOptions {
  const sourceDir = path.resolve(process.cwd(), ".local", "soundscape", "raw");
  const options: CliOptions = {
    sourceDir,
    analysisPath: path.join(sourceDir, "analysis.generated.json"),
    outDir: path.resolve(process.cwd(), "assets", "soundscape-normalized"),
    force: false,
    includeDead: false,
    ffmpegPath: "ffmpeg"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--source-dir":
        options.sourceDir = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        options.analysisPath = path.join(options.sourceDir, "analysis.generated.json");
        break;
      case "--analysis":
        options.analysisPath = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--out-dir":
        options.outDir = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--force":
        options.force = true;
        break;
      case "--include-dead":
        options.includeDead = true;
        break;
      case "--ffmpeg":
        options.ffmpegPath = requiredValue(args, ++index, arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function normalizeAssets(options: CliOptions): NormalizationEntry[] {
  const report = JSON.parse(fs.readFileSync(options.analysisPath, "utf8")) as SoundscapeAnalysisReport;
  const entries: NormalizationEntry[] = [];

  for (const asset of report.assets) {
    if (asset.status === "dead" && !options.includeDead) {
      continue;
    }

    const inputPath = path.join(options.sourceDir, asset.file);
    const outputPath = path.join(options.outDir, asset.file);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const entry: NormalizationEntry = {
      source: path.relative(process.cwd(), inputPath),
      output: path.relative(process.cwd(), outputPath),
      kind: asset.kind,
      status: asset.status,
      requestedGainDb: roundDb(asset.recommendedGainDb),
      appliedGainDb: normalizationGainDb(asset),
      skipped: false
    };

    if (!options.force && fs.existsSync(outputPath)) {
      entry.skipped = true;
      entries.push(entry);
      continue;
    }

    execFileSync(
      options.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-af",
        `volume=${entry.appliedGainDb}dB`,
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputPath
      ],
      { stdio: "inherit" }
    );
    entries.push(entry);
  }

  writeJsonAtomic(path.join(options.outDir, "normalization.generated.json"), {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceDir: options.sourceDir,
    analysisPath: options.analysisPath,
    entries
  });

  return entries;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const entries = normalizeAssets(options);
  const skipped = entries.filter((entry) => entry.skipped).length;
  console.log(
    `soundscape normalization: ${entries.length} asset(s), ${skipped} skipped, output=${path.relative(process.cwd(), options.outDir)}`
  );
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function roundDb(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizationGainDb(asset: SoundscapeAssetAnalysis): number {
  const peakHeadroomGainDb = -3 - asset.peakDb;
  if (asset.recommendedGainDb > 0) {
    return roundDb(Math.min(asset.recommendedGainDb, peakHeadroomGainDb));
  }
  return roundDb(asset.recommendedGainDb);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
