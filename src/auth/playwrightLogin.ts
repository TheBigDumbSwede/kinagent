import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import { currentBrowserSessionStorage } from "./browserSessionStorage.js";
import type { BrowserStorageState } from "./firebaseSession.js";
import { ensureSessionDir } from "./tokenStore.js";

export async function runKindroidLogin(config: AppConfig, logger: Logger): Promise<void> {
  ensureSessionDir(config.bridge.sessionDir);

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

  const storageState = (await context.storageState({ indexedDB: true })) as BrowserStorageState;
  currentBrowserSessionStorage().save(config.bridge.sessionDir, storageState);
  await browser.close();

  logger.info("Kindroid browser session saved.", {
    path: currentBrowserSessionStorage().storageStatePath(config.bridge.sessionDir)
  });
  process.stdout.write("Session saved. Tokens and cookies were not printed.\n");
}
