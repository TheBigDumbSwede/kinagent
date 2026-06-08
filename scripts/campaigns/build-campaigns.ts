#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import {
  buildCampaignAsset,
  campaignOutputRoot,
  loadCampaignSources,
  writeCampaignIndex
} from "./campaignPackLibrary.js";

export function main(): void {
  const sources = loadCampaignSources();
  if (sources.length === 0) {
    throw new Error("No campaign packs found under campaigns/packs.");
  }

  fs.rmSync(campaignOutputRoot, { recursive: true, force: true });
  fs.mkdirSync(campaignOutputRoot, { recursive: true });

  const assets = sources.map((source) => buildCampaignAsset(source));
  const indexPath = writeCampaignIndex(assets);

  for (const asset of assets) {
    process.stdout.write(
      `Built ${path.relative(process.cwd(), asset.filePath)} (${asset.bytes} bytes, sha256 ${asset.sha256}).\n`
    );
  }
  process.stdout.write(`Wrote ${path.relative(process.cwd(), indexPath)}.\n`);
}

main();
