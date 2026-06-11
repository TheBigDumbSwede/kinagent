import { chromium, type BrowserContextOptions } from "playwright";
import type { AppConfig } from "../config/types.js";
import {
  applySetCookieHeaders,
  buildCookieHeader,
  loadBrowserSession,
  loadFreshFirebaseAuth,
  saveBrowserStorageState
} from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";

export interface KindroidSessionKeepAliveEvent {
  ok: boolean;
  warmed?: boolean;
  method?: "http" | "browser" | "skipped";
  uidPresent?: boolean;
  expirationIso?: string | null;
  error?: string;
}

export interface KindroidSessionKeepAliveOptions {
  config: AppConfig;
  logger: Logger;
  intervalMs?: number;
  shouldSkipWarm?: () => boolean;
  onKeepAlive?: (event: KindroidSessionKeepAliveEvent) => void;
}

const defaultIntervalMs = 25 * 60 * 1000;

export class KindroidSessionKeepAlive {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly options: KindroidSessionKeepAliveOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }

    void this.run();
    this.timer = setInterval(() => {
      void this.run();
    }, this.options.intervalMs ?? defaultIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;
    try {
      const auth = await loadFreshFirebaseAuth(this.options.config.bridge.sessionDir);
      const warmResult = await this.warmKindroidSession();
      this.options.onKeepAlive?.({
        ok: true,
        warmed: warmResult.warmed,
        method: warmResult.method,
        uidPresent: Boolean(auth.uid),
        expirationIso: auth.expirationTime ? new Date(auth.expirationTime).toISOString() : null
      });
    } catch (error) {
      this.options.onKeepAlive?.({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.inFlight = false;
    }
  }

  private async warmKindroidSession(): Promise<{ warmed: boolean; method: "http" | "browser" | "skipped" }> {
    if (this.options.shouldSkipWarm?.()) {
      return { warmed: false, method: "skipped" };
    }

    try {
      const cookieUpdates = await this.warmKindroidHttpSession();
      this.options.logger.debug("Kindroid session warmed over HTTP.", { cookieUpdates });
      return { warmed: true, method: "http" };
    } catch (error) {
      this.options.logger.warn("HTTP Kindroid session warm failed; falling back to browser warm.", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await this.warmKindroidBrowserSession();
    return { warmed: true, method: "browser" };
  }

  private async warmKindroidHttpSession(): Promise<number> {
    const session = loadBrowserSession(this.options.config.bridge.sessionDir);
    const cookieHeader = buildCookieHeader(session.storageState, "kindroid.ai");
    if (!cookieHeader) {
      throw new Error("Saved session has no Kindroid cookies to warm.");
    }

    const url = "https://kindroid.ai/";
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        cookie: cookieHeader,
        "user-agent": "Kinagent session warmer"
      }
    });

    if (!response.ok) {
      throw new Error(`Kindroid HTTP warm failed with HTTP ${response.status}.`);
    }

    const setCookieHeaders = responseSetCookieHeaders(response.headers);
    const cookieUpdates = applySetCookieHeaders(session.storageState, setCookieHeaders, response.url || url);
    if (cookieUpdates > 0) {
      saveBrowserStorageState(this.options.config.bridge.sessionDir, session.storageState);
    }

    return cookieUpdates;
  }

  private async warmKindroidBrowserSession(): Promise<void> {
    const session = loadBrowserSession(this.options.config.bridge.sessionDir);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        storageState: session.storageState as BrowserContextOptions["storageState"]
      });
      const page = await context.newPage();
      await page.goto("https://kindroid.ai/", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      saveBrowserStorageState(
        this.options.config.bridge.sessionDir,
        (await context.storageState({ indexedDB: true })) as typeof session.storageState
      );
      this.options.logger.debug("Kindroid browser session warmed.", { url: page.url() });
    } finally {
      await browser.close();
    }
  }
}

function responseSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieHeaders = withGetSetCookie.getSetCookie?.();
  if (setCookieHeaders && setCookieHeaders.length > 0) {
    return setCookieHeaders;
  }

  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookieHeader(combined) : [];
}

function splitCombinedSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[^;,\s]+=)/).map((header) => header.trim());
}
