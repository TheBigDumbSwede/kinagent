import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import {
  campaignPackDirectories,
  loadCampaignPackDirectory,
  loadCampaignPacks,
  loadSingleCampaignPackFile,
  summarizeCampaignPack,
  type CampaignPackSummary,
  type LoadedCampaignPack
} from "./campaignPack.js";

export interface CampaignPackImportResult {
  ok: true;
  campaign: CampaignPackSummary;
  installedPath: string;
}

export function importCampaignPack(config: AppConfig, sourcePath: string): CampaignPackImportResult {
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error("Campaign pack file was not found.");
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-campaign-import-"));
  try {
    const pack = loadImportCandidate(resolvedSourcePath, tempRoot);
    ensureUniqueCampaignId(config, pack);
    const installPath = installCampaignPack(config, pack, resolvedSourcePath);
    return {
      ok: true,
      campaign: summarizeCampaignPack({ ...pack, source: "local", sourcePath: installPath }),
      installedPath: installPath
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function loadImportCandidate(sourcePath: string, tempRoot: string): LoadedCampaignPack {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".zip") {
    const unpackedRoot = path.join(tempRoot, "unzipped");
    fs.mkdirSync(unpackedRoot, { recursive: true });
    extractZipSafely(sourcePath, unpackedRoot);
    return loadSinglePackFromDirectory(findCampaignPackRoot(unpackedRoot));
  }

  if (extension === ".json") {
    return loadSingleCampaignPackFile(sourcePath)[0] ?? fail("Campaign pack JSON did not load.");
  }

  throw new Error("Campaign import supports .zip and .json files.");
}

function extractZipSafely(sourcePath: string, destination: string): void {
  const zip = new AdmZip(sourcePath);
  for (const entry of zip.getEntries()) {
    const targetPath = safeExtractPath(destination, entry.entryName);
    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
  }
}

function safeExtractPath(destination: string, entryName: string): string {
  const normalizedEntry = entryName.replaceAll("\\", "/");
  if (!normalizedEntry || normalizedEntry.startsWith("/") || normalizedEntry.includes("\0")) {
    throw new Error(`Unsafe campaign zip entry: ${entryName}`);
  }

  const resolved = path.resolve(destination, normalizedEntry);
  const resolvedDestination = path.resolve(destination);
  if (resolved !== resolvedDestination && !resolved.startsWith(`${resolvedDestination}${path.sep}`)) {
    throw new Error(`Unsafe campaign zip entry: ${entryName}`);
  }
  return resolved;
}

function findCampaignPackRoot(unpackedRoot: string): string {
  const manifests = findCampaignManifests(unpackedRoot).filter(
    (manifest) => !manifest.includes(`${path.sep}__MACOSX${path.sep}`)
  );
  if (manifests.length !== 1) {
    throw new Error(`Expected exactly one campaign.json in the campaign zip; found ${manifests.length}.`);
  }
  return path.dirname(manifests[0]);
}

function findCampaignManifests(directory: string): string[] {
  const manifests: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...findCampaignManifests(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name === "campaign.json") {
      manifests.push(entryPath);
    }
  }
  return manifests;
}

function loadSinglePackFromDirectory(directory: string): LoadedCampaignPack {
  return loadCampaignPackDirectory(directory)[0] ?? fail("Campaign pack directory did not load.");
}

function ensureUniqueCampaignId(config: AppConfig, pack: LoadedCampaignPack): void {
  const existing = loadCampaignPacks(config).find((candidate) => candidate.id === pack.id);
  if (existing) {
    throw new Error(`Campaign pack "${pack.title}" already exists (${pack.id}).`);
  }
}

function installCampaignPack(config: AppConfig, pack: LoadedCampaignPack, sourcePath: string): string {
  const [campaignDirectory] = campaignPackDirectories(config);
  if (!campaignDirectory) {
    throw new Error("No campaign import directory is configured.");
  }
  fs.mkdirSync(campaignDirectory, { recursive: true });

  if (path.extname(sourcePath).toLowerCase() === ".json") {
    const destinationFile = path.join(campaignDirectory, `${safeDirectoryName(pack.id)}.json`);
    if (fs.existsSync(destinationFile)) {
      throw new Error(`Campaign file already exists: ${destinationFile}`);
    }
    fs.copyFileSync(sourcePath, destinationFile);
    return destinationFile;
  }

  const destination = path.join(campaignDirectory, safeDirectoryName(pack.id));
  if (fs.existsSync(destination)) {
    throw new Error(`Campaign directory already exists: ${destination}`);
  }

  fs.cpSync(path.dirname(pack.sourcePath ?? sourcePath), destination, { recursive: true, errorOnExist: true });
  return path.join(destination, "campaign.json");
}

function safeDirectoryName(id: string): string {
  const name = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "campaign-pack";
}

function fail(message: string): never {
  throw new Error(message);
}
