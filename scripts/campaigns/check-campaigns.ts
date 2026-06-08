#!/usr/bin/env tsx
import { loadCampaignSources } from "./campaignPackLibrary.js";

export function main(): void {
  const sources = loadCampaignSources();
  if (sources.length === 0) {
    throw new Error("No campaign packs found under campaigns/packs.");
  }

  for (const source of sources) {
    process.stdout.write(`Validated campaign pack ${source.pack.id} (${source.pack.mysteries.length} mysteries).\n`);
  }
}

main();
