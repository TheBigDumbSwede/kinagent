import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config/types.js";
import type { Logger } from "../util/logger.js";
import { ensureSessionDir, storageStatePath } from "./tokenStore.js";

interface InstrumentedLoginOptions {
  durationSeconds: number;
}

interface InstrumentationReport {
  startedAt: string;
  finishedAt?: string;
  url: string;
  cryptoEvents: unknown[];
  networkEvents: unknown[];
  scriptEvents: unknown[];
  storageSummary?: unknown;
}

export async function runInstrumentedKindroidLogin(
  config: AppConfig,
  logger: Logger,
  options: InstrumentedLoginOptions
): Promise<string> {
  ensureSessionDir(config.bridge.sessionDir);
  const statePath = storageStatePath(config.bridge.sessionDir);
  const reportPath = path.join(
    config.bridge.sessionDir,
    `instrumentation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

  const report: InstrumentationReport = {
    startedAt: new Date().toISOString(),
    url: "https://kindroid.ai/",
    cryptoEvents: [],
    networkEvents: [],
    scriptEvents: []
  };

  logger.info("Opening instrumented browser for Kindroid login.", {
    durationSeconds: options.durationSeconds,
    reportPath
  });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await installCryptoInstrumentation(context, report);
  attachNetworkInstrumentation(context, report);

  const page = await context.newPage();
  await page.goto(report.url, { waitUntil: "domcontentloaded" });

  process.stdout.write(
    [
      "",
      `Instrumented browser is open for ${options.durationSeconds} seconds.`,
      "Log in to Kindroid, open a Kin chat, and let the chat finish loading.",
      "The report will save token-safe metadata only.",
      ""
    ].join("\n")
  );

  await page.waitForTimeout(options.durationSeconds * 1000);
  await context.storageState({ path: statePath, indexedDB: true });
  report.storageSummary = await summarizeStorage(page);
  report.finishedAt = new Date().toISOString();

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await browser.close();

  logger.info("Instrumented Kindroid session saved.", {
    storageStatePath: statePath,
    reportPath
  });
  process.stdout.write(`Instrumentation report saved: ${reportPath}\n`);
  return reportPath;
}

async function installCryptoInstrumentation(
  context: BrowserContext,
  report: InstrumentationReport
): Promise<void> {
  await context.exposeBinding("__kinagentCryptoEvent", (_source, event: unknown) => {
    report.cryptoEvents.push(event);
  });

  await context.addInitScript(() => {
    const maxEvents = 500;
    let eventCount = 0;

    function emit(event: Record<string, unknown>): void {
      eventCount += 1;
      if (eventCount > maxEvents) {
        return;
      }

      const target = window as Window & {
        __kinagentCryptoEvent?: (event: unknown) => Promise<void>;
      };
      void target.__kinagentCryptoEvent?.({
        ...event,
        time: new Date().toISOString()
      });
    }

    function summarizeAlgorithm(value: unknown): unknown {
      if (typeof value === "string") {
        return { name: value };
      }
      if (!value || typeof value !== "object") {
        return typeof value;
      }
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(record).map(([key, nested]) => {
          if (key.toLowerCase().includes("iv")) {
            return [key, byteLength(nested)];
          }
          if (key.toLowerCase().includes("salt")) {
            return [key, byteLength(nested)];
          }
          if (nested instanceof ArrayBuffer || ArrayBuffer.isView(nested)) {
            return [key, byteLength(nested)];
          }
          return [key, typeof nested === "object" ? summarizeAlgorithm(nested) : nested];
        })
      );
    }

    function summarizeKeyData(value: unknown): unknown {
      if (typeof value === "string") {
        return { type: "string", length: value.length };
      }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return { type: "bytes", byteLength: byteLength(value) };
      }
      if (!value || typeof value !== "object") {
        return { type: typeof value };
      }

      const record = value as Record<string, unknown>;
      return {
        type: "object",
        keys: Object.keys(record),
        jwkMetadata: {
          kty: record.kty,
          alg: record.alg,
          crv: record.crv,
          ext: record.ext,
          key_ops: record.key_ops
        }
      };
    }

    function summarizeCryptoKey(value: unknown): unknown {
      if (!(value instanceof CryptoKey)) {
        return { type: typeof value };
      }

      return {
        type: value.type,
        extractable: value.extractable,
        algorithm: summarizeAlgorithm(value.algorithm),
        usages: value.usages
      };
    }

    function byteLength(value: unknown): number | null {
      if (value instanceof ArrayBuffer) {
        return value.byteLength;
      }
      if (ArrayBuffer.isView(value)) {
        return value.byteLength;
      }
      return null;
    }

    const subtle = crypto?.subtle;
    if (!subtle) {
      emit({ type: "crypto.unavailable" });
      return;
    }

    const originalImportKey = subtle.importKey.bind(subtle);
    subtle.importKey = async function patchedImportKey(
      format,
      keyData,
      algorithm,
      extractable,
      keyUsages
    ) {
      emit({
        type: "crypto.subtle.importKey",
        format,
        keyData: summarizeKeyData(keyData),
        algorithm: summarizeAlgorithm(algorithm),
        extractable,
        keyUsages
      });
      return originalImportKey(
        format as "raw",
        keyData as BufferSource,
        algorithm,
        extractable,
        keyUsages
      );
    };

    const originalDeriveKey = subtle.deriveKey.bind(subtle);
    subtle.deriveKey = async function patchedDeriveKey(
      algorithm,
      baseKey,
      derivedKeyType,
      extractable,
      keyUsages
    ) {
      emit({
        type: "crypto.subtle.deriveKey",
        algorithm: summarizeAlgorithm(algorithm),
        baseKey: summarizeCryptoKey(baseKey),
        derivedKeyType: summarizeAlgorithm(derivedKeyType),
        extractable,
        keyUsages
      });
      return originalDeriveKey(algorithm, baseKey, derivedKeyType, extractable, keyUsages);
    };

    const originalDecrypt = subtle.decrypt.bind(subtle);
    subtle.decrypt = async function patchedDecrypt(algorithm, key, data) {
      emit({
        type: "crypto.subtle.decrypt",
        algorithm: summarizeAlgorithm(algorithm),
        key: summarizeCryptoKey(key),
        data: { byteLength: byteLength(data) }
      });
      return originalDecrypt(algorithm, key, data);
    };
  });
}

function attachNetworkInstrumentation(context: BrowserContext, report: InstrumentationReport): void {
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (!isInterestingHost(url.host)) {
      return;
    }

    const postData = request.postData();
    report.networkEvents.push({
      type: "request",
      method: request.method(),
      host: url.host,
      path: url.pathname,
      queryKeys: [...url.searchParams.keys()],
      postShape: summarizePostData(postData)
    });
  });

  context.on("response", async (response) => {
    const url = new URL(response.url());
    if (!isInterestingHost(url.host)) {
      return;
    }

    const contentType = response.headers()["content-type"] ?? "";
    report.networkEvents.push({
      type: "response",
      status: response.status(),
      host: url.host,
      path: url.pathname,
      contentType
    });

    if (url.pathname.endsWith(".js") || contentType.includes("javascript")) {
      report.scriptEvents.push({
        url: `${url.origin}${url.pathname}`,
        status: response.status()
      });
    }
  });
}

async function summarizeStorage(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const localStorageKeys = Object.keys(localStorage).sort();
    const indexedDbDatabases =
      typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];

    return {
      origin: location.origin,
      localStorageKeys,
      indexedDbDatabases: indexedDbDatabases.map((database) => ({
        name: database.name,
        version: database.version
      }))
    };
  });
}

function isInterestingHost(host: string): boolean {
  return (
    host === "kindroid.ai" ||
    host === "api.kindroid.ai" ||
    host === "firestore.googleapis.com" ||
    host === "identitytoolkit.googleapis.com" ||
    host === "securetoken.googleapis.com"
  );
}

function summarizePostData(postData: string | null): unknown {
  if (!postData) {
    return null;
  }

  try {
    const parsed = JSON.parse(postData) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        type: "json",
        keys: Object.keys(parsed)
      };
    }
    return { type: "json", valueType: typeof parsed };
  } catch {
    const params = new URLSearchParams(postData);
    const keys = [...params.keys()];
    if (keys.length > 0) {
      return {
        type: "form",
        keys
      };
    }
  }

  return {
    type: "text",
    length: postData.length
  };
}
