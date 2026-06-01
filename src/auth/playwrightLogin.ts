import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import { ensureSessionDir, storageStatePath } from "./tokenStore.js";

export async function runKindroidLogin(config: AppConfig, logger: Logger): Promise<void> {
  ensureSessionDir(config.bridge.sessionDir);
  const statePath = storageStatePath(config.bridge.sessionDir);

  logger.info("Opening a visible browser for Kindroid login.");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://kindroid.ai/", { waitUntil: "domcontentloaded" });

  const rl = createInterface({ input, output });
  try {
    await rl.question("Log in to Kindroid in the browser, then press Enter here to save the session.");
  } finally {
    rl.close();
  }

  await context.storageState({ path: statePath, indexedDB: true });
  await browser.close();

  logger.info("Kindroid browser session saved.", { path: statePath });
  process.stdout.write("Session saved. Tokens and cookies were not printed.\n");
}
