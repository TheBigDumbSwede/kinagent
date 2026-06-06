export type SoundscapeAssetStatus = "dead" | "weak" | "ok" | "hot";

export interface SoundscapeAssetMetrics {
  file: string;
  assetKey?: string;
  kind: "loop" | "oneShot";
  durationSeconds: number;
  peakDb: number;
  rmsDb: number;
  maxWindowRmsDb: number;
  activePercent: number;
  strongPercent: number;
  nearZeroPercent: number;
}

export interface SoundscapeAssetAnalysis extends SoundscapeAssetMetrics {
  status: SoundscapeAssetStatus;
  reasons: string[];
  targetDb: number;
  recommendedGainDb: number;
}

export interface SoundscapeAnalysisReport {
  version: number;
  generatedAt: string;
  outDir: string;
  totals: Record<SoundscapeAssetStatus, number> & { total: number };
  assets: SoundscapeAssetAnalysis[];
}

const loopTargetRmsDb = -32;
const cueTargetMaxWindowRmsDb = -24;
const maxPositiveGainDb = 18;
const peakHeadroomDb = -3;

export function analyzeSoundscapeAsset(metrics: SoundscapeAssetMetrics): SoundscapeAssetAnalysis {
  const reasons: string[] = [];
  const targetDb = metrics.kind === "loop" ? loopTargetRmsDb : cueTargetMaxWindowRmsDb;
  const measuredDb = metrics.kind === "loop" ? metrics.rmsDb : metrics.maxWindowRmsDb;
  const gainToTarget = targetDb - measuredDb;
  const gainToHeadroom = peakHeadroomDb - metrics.peakDb;
  const recommendedGainDb = roundDb(clamp(gainToTarget, Math.min(-12, gainToHeadroom), maxPositiveGainDb));

  if (metrics.peakDb <= -50 || metrics.maxWindowRmsDb <= -58 || metrics.activePercent < 1) {
    reasons.push("effectively silent");
  }
  if (metrics.nearZeroPercent >= 90) {
    reasons.push("mostly near-zero samples");
  }
  if (metrics.peakDb > -1) {
    reasons.push("peak is close to clipping");
  }
  if (metrics.kind === "loop" && metrics.rmsDb < -52) {
    reasons.push("loop bed is far below target loudness");
  }
  if (metrics.kind === "oneShot" && metrics.maxWindowRmsDb < -42) {
    reasons.push("cue event is far below target loudness");
  }
  if (recommendedGainDb >= 8) {
    reasons.push("requires large gain boost");
  }

  let status: SoundscapeAssetStatus = "ok";
  const mostlyEmptyLoop = metrics.kind === "loop" && reasons.includes("mostly near-zero samples");
  const mostlyEmptyCue = metrics.kind === "oneShot" && metrics.nearZeroPercent >= 95 && metrics.maxWindowRmsDb < -42;

  if (reasons.includes("effectively silent") || mostlyEmptyLoop || mostlyEmptyCue) {
    status = "dead";
  } else if (reasons.includes("peak is close to clipping")) {
    status = "hot";
  } else if (
    reasons.includes("loop bed is far below target loudness") ||
    reasons.includes("cue event is far below target loudness") ||
    reasons.includes("requires large gain boost")
  ) {
    status = "weak";
  }

  return {
    ...metrics,
    status,
    reasons,
    targetDb,
    recommendedGainDb
  };
}

export function summarizeSoundscapeAnalysis(
  assets: SoundscapeAssetAnalysis[],
  options: { outDir: string; generatedAt?: string }
): SoundscapeAnalysisReport {
  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    outDir: options.outDir,
    totals: {
      total: assets.length,
      dead: assets.filter((asset) => asset.status === "dead").length,
      weak: assets.filter((asset) => asset.status === "weak").length,
      ok: assets.filter((asset) => asset.status === "ok").length,
      hot: assets.filter((asset) => asset.status === "hot").length
    },
    assets: [...assets].sort(
      (left, right) => statusSort(left.status) - statusSort(right.status) || left.file.localeCompare(right.file)
    )
  };
}

export function dbFromAmplitude(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundDb(value: number): number {
  return Math.round(value * 10) / 10;
}

function statusSort(status: SoundscapeAssetStatus): number {
  switch (status) {
    case "dead":
      return 0;
    case "weak":
      return 1;
    case "hot":
      return 2;
    case "ok":
      return 3;
  }
}
