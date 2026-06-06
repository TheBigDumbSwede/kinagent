#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  analyzeSoundscapeAsset,
  summarizeSoundscapeAnalysis,
  type SoundscapeAssetAnalysis,
  type SoundscapeAssetMetrics
} from "../../src/soundscape/generation/audioAnalysis.js";
import {
  readGeneratedCatalog,
  writeJsonAtomic,
  type GeneratedSoundscapeCatalog
} from "../../src/soundscape/generation/palette.js";

interface CliOptions {
  outDir: string;
  reportPath: string;
  writeCatalogAnalysis: boolean;
  failOnDead: boolean;
}

interface CatalogAsset {
  filePath: string;
  file: string;
  assetKey: string;
  kind: "loop" | "oneShot";
  catalogId?: string;
  variant?: number;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const catalogPath = path.join(options.outDir, "catalog.generated.json");
  const catalog = readGeneratedCatalog(catalogPath);
  const assets = listCatalogAssets(options.outDir, catalog);
  if (assets.length === 0) {
    throw new Error(`No generated audio assets found under ${options.outDir}.`);
  }

  const analyses = await analyzeAssets(assets);
  const report = summarizeSoundscapeAnalysis(analyses, { outDir: options.outDir });
  writeJsonAtomic(options.reportPath, report);

  if (options.writeCatalogAnalysis) {
    writeJsonAtomic(catalogPath, annotateCatalog(catalog, analyses, report.generatedAt));
  }

  printSummary(report, options.reportPath);

  if (options.failOnDead && report.totals.dead > 0) {
    process.exitCode = 1;
  }
}

export function parseArgs(args: string[]): CliOptions {
  const outDir = path.resolve(process.cwd(), ".local", "soundscape", "raw");
  const options: CliOptions = {
    outDir,
    reportPath: path.join(outDir, "analysis.generated.json"),
    writeCatalogAnalysis: false,
    failOnDead: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--out-dir":
        options.outDir = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        options.reportPath = path.join(options.outDir, "analysis.generated.json");
        break;
      case "--report":
        options.reportPath = path.resolve(process.cwd(), requiredValue(args, ++index, arg));
        break;
      case "--write-catalog-analysis":
        options.writeCatalogAnalysis = true;
        break;
      case "--fail-on-dead":
        options.failOnDead = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function listCatalogAssets(outDir: string, catalog: GeneratedSoundscapeCatalog): CatalogAsset[] {
  const byAssetKey = new Map(catalog.entries.map((entry) => [entry.assetKey, entry]));
  return findAudioFiles(outDir).map((filePath) => {
    const file = path.relative(outDir, filePath).replaceAll("\\", "/");
    const assetKey = `soundscape/${file}`;
    const entry = byAssetKey.get(assetKey);
    const kind = entry?.kind ?? (file.startsWith("loops/") ? "loop" : "oneShot");
    return {
      filePath,
      file,
      assetKey,
      kind,
      catalogId: entry?.id,
      variant: entry?.variant
    };
  });
}

export async function analyzeAssets(assets: CatalogAsset[]): Promise<SoundscapeAssetAnalysis[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<html></html>");
    const analyses: SoundscapeAssetAnalysis[] = [];

    for (const asset of assets) {
      const base64 = fs.readFileSync(asset.filePath).toString("base64");
      const metrics = (await page.evaluate(
        browserDecodeAndMeasureScript({
          base64,
          file: asset.file,
          assetKey: asset.assetKey,
          kind: asset.kind
        })
      )) as SoundscapeAssetMetrics;
      analyses.push(analyzeSoundscapeAsset(metrics));
    }

    await page.close();
    return analyses;
  } finally {
    await browser.close();
  }
}

function annotateCatalog(
  catalog: GeneratedSoundscapeCatalog,
  analyses: SoundscapeAssetAnalysis[],
  analyzedAt: string
): GeneratedSoundscapeCatalog {
  const byAssetKey = new Map(analyses.map((analysis) => [analysis.assetKey, analysis]));
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => {
      const analysis = byAssetKey.get(entry.assetKey);
      if (!analysis) {
        return entry;
      }
      return {
        ...entry,
        analysis: {
          status: analysis.status,
          reasons: analysis.reasons,
          peakDb: analysis.peakDb,
          rmsDb: analysis.rmsDb,
          maxWindowRmsDb: analysis.maxWindowRmsDb,
          activePercent: analysis.activePercent,
          nearZeroPercent: analysis.nearZeroPercent,
          recommendedGainDb: analysis.recommendedGainDb,
          analyzedAt
        }
      };
    })
  };
}

function findAudioFiles(outDir: string): string[] {
  const files: string[] = [];
  for (const folder of ["loops", "cues"]) {
    const dir = path.join(outDir, folder);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.(mp3|wav)$/i.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  return files.sort();
}

function printSummary(report: ReturnType<typeof summarizeSoundscapeAnalysis>, reportPath: string): void {
  console.log(
    `soundscape analysis: ${report.totals.total} asset(s), ${report.totals.dead} dead, ${report.totals.weak} weak, ${report.totals.hot} hot, ${report.totals.ok} ok`
  );
  for (const asset of report.assets.filter((item) => item.status !== "ok")) {
    console.log(
      `${asset.status}: ${asset.file} peak=${asset.peakDb.toFixed(1)}dB rms=${asset.rmsDb.toFixed(1)}dB maxWindow=${asset.maxWindowRmsDb.toFixed(1)}dB gain=${asset.recommendedGainDb.toFixed(1)}dB ${asset.reasons.join("; ")}`
    );
  }
  console.log(`wrote: ${path.relative(process.cwd(), reportPath)}`);
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function browserDecodeAndMeasureScript(input: {
  base64: string;
  file: string;
  assetKey: string;
  kind: "loop" | "oneShot";
}): string {
  return `
    (async () => {
      const input = ${JSON.stringify(input)};
      const dbFromAmplitude = (value) => value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
      const averageChannels = (channels, index) => {
        let sample = 0;
        for (const channel of channels) {
          sample += channel[index] ?? 0;
        }
        return sample / Math.max(1, channels.length);
      };
      const bytes = Uint8Array.from(atob(input.base64), (char) => char.charCodeAt(0));
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(bytes.buffer.slice(0));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        const windowSize = Math.max(1, Math.floor(buffer.sampleRate * 0.05));
        let sumSq = 0;
        let peak = 0;
        let nearZero = 0;
        const windows = [];

        for (let index = 0; index < buffer.length; index += 1) {
          const sample = averageChannels(channels, index);
          const abs = Math.abs(sample);
          peak = Math.max(peak, abs);
          sumSq += sample * sample;
          if (abs < 0.0005) {
            nearZero += 1;
          }
        }

        for (let start = 0; start < buffer.length; start += windowSize) {
          let localSq = 0;
          let count = 0;
          for (let index = start; index < Math.min(buffer.length, start + windowSize); index += 1) {
            const sample = averageChannels(channels, index);
            localSq += sample * sample;
            count += 1;
          }
          windows.push(Math.sqrt(localSq / Math.max(1, count)));
        }

        const rmsDb = dbFromAmplitude(Math.sqrt(sumSq / Math.max(1, buffer.length)));
        const windowDb = windows.map((value) => dbFromAmplitude(value));
        return {
          file: input.file,
          assetKey: input.assetKey,
          kind: input.kind,
          durationSeconds: buffer.duration,
          peakDb: dbFromAmplitude(peak),
          rmsDb,
          maxWindowRmsDb: Math.max(...windowDb),
          activePercent: (windowDb.filter((value) => value > -55).length / windows.length) * 100,
          strongPercent: (windowDb.filter((value) => value > -35).length / windows.length) * 100,
          nearZeroPercent: (nearZero / buffer.length) * 100
        };
      } finally {
        await context.close();
      }
    })()
  `;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
