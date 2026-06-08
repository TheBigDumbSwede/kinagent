#!/usr/bin/env tsx
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadCampaignPackDirectory,
  summarizeCampaignPack,
  type CampaignPackSummary,
  type LoadedCampaignPack
} from "../../src/game/campaignPack.js";

export const projectRoot = path.resolve(import.meta.dirname, "..", "..");
export const campaignSourceRoot = path.join(projectRoot, "campaigns", "packs");
export const campaignOutputRoot = path.join(projectRoot, "release", "campaigns");

export interface CampaignSource {
  directoryName: string;
  directoryPath: string;
  pack: LoadedCampaignPack;
}

export interface CampaignAsset {
  campaign: CampaignPackSummary;
  file: string;
  filePath: string;
  bytes: number;
  sha256: string;
}

export interface CampaignAssetIndex {
  schemaVersion: 1;
  campaigns: Array<CampaignPackSummary & { file: string; bytes: number; sha256: string }>;
}

export function loadCampaignSources(root = campaignSourceRoot): CampaignSource[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directoryPath = path.join(root, entry.name);
      const packs = loadCampaignPackDirectory(directoryPath);
      if (packs.length !== 1) {
        throw new Error(`Expected exactly one campaign pack under ${directoryPath}; found ${packs.length}.`);
      }
      return {
        directoryName: entry.name,
        directoryPath,
        pack: packs[0]
      };
    })
    .sort((left, right) => left.pack.title.localeCompare(right.pack.title));
}

export function buildCampaignAsset(source: CampaignSource, outputRoot = campaignOutputRoot): CampaignAsset {
  fs.mkdirSync(outputRoot, { recursive: true });
  const file = `${safeFileName(source.pack.id)}.zip`;
  const filePath = path.join(outputRoot, file);
  const zip = new AdmZip();
  addDirectoryToZip(zip, source.directoryPath, safeFileName(source.pack.id));
  zip.writeZip(filePath);
  const content = fs.readFileSync(filePath);
  return {
    campaign: summarizeCampaignPack(source.pack),
    file,
    filePath,
    bytes: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}

export function writeCampaignIndex(assets: CampaignAsset[], outputRoot = campaignOutputRoot): string {
  const index: CampaignAssetIndex = {
    schemaVersion: 1,
    campaigns: assets.map((asset) => ({
      ...asset.campaign,
      file: asset.file,
      bytes: asset.bytes,
      sha256: asset.sha256
    }))
  };
  const indexPath = path.join(outputRoot, "campaign-index.json");
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return indexPath;
}

export function safeFileName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "campaign-pack";
}

function addDirectoryToZip(zip: AdmZip, directoryPath: string, zipRoot: string): void {
  const entries = fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    const zipPath = `${zipRoot}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, absolutePath, zipPath);
      continue;
    }
    if (entry.isFile()) {
      zip.addFile(zipPath, fs.readFileSync(absolutePath));
    }
  }
}
