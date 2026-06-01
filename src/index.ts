import { Command } from "commander";
import { loadConfig } from "./config/loadConfig.js";
import { loadBrowserSession, summarizeSessionAuth } from "./auth/firebaseSession.js";
import { runInstrumentedKindroidLogin } from "./auth/instrumentedLogin.js";
import { runKindroidLogin } from "./auth/playwrightLogin.js";
import { KindroidClient } from "./kindroid/kindroidClient.js";
import { listKinsFromSession } from "./kindroid/sessionKins.js";
import { KindroidChatListener } from "./firestore/chatListener.js";
import { FirestoreRestClient } from "./firestore/firestoreRestClient.js";
import { KindroidLiveMonitor } from "./firestore/liveMonitor.js";
import { mapKindroidMessage } from "./firestore/messageMapper.js";
import { createHermesAdapter } from "./hermes/hermesAdapter.js";
import { createDedupeStore } from "./state/sqliteStore.js";
import { newRequestId } from "./util/ids.js";
import { createLogger, redactSecrets } from "./util/logger.js";

const program = new Command();

program
  .name("kinagent")
  .description("Headless Kindroid to Hermes bridge prototype.")
  .option("-c, --config <path>", "Path to config.yaml")
  .showHelpAfterError();

program
  .command("login")
  .description("Open Kindroid in Chromium and save local browser session state.")
  .action(async () => {
    const { config, logger } = loadRuntime();
    await runKindroidLogin(config, logger);
  });

program
  .command("instrument-login")
  .description("Open Kindroid with token-safe crypto/network instrumentation enabled.")
  .option("--duration-seconds <seconds>", "How long to keep the browser open", "120")
  .action(async (options: { durationSeconds: string }) => {
    const durationSeconds = Number(options.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
      throw new Error("--duration-seconds must be at least 10.");
    }

    const { config, logger } = loadRuntime();
    await runInstrumentedKindroidLogin(config, logger, { durationSeconds });
  });

program
  .command("list-kins")
  .description("List cached Kindroid Kins from the saved browser session.")
  .action(() => {
    const { config } = loadRuntime();
    const kins = listKinsFromSession(config.bridge.sessionDir);
    process.stdout.write(`${JSON.stringify({ count: kins.length, kins }, null, 2)}\n`);
  });

program
  .command("session-info")
  .description("Print a safe summary of saved session auth state.")
  .action(() => {
    const { config } = loadRuntime();
    const session = loadBrowserSession(config.bridge.sessionDir);
    process.stdout.write(`${JSON.stringify(summarizeSessionAuth(session.storageState), null, 2)}\n`);
  });

program
  .command("probe-chat")
  .description("Read recent Firestore chat documents for one Kin and print normalized JSON.")
  .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
  .option("--limit <count>", "Maximum documents to read", "5")
  .option("--decrypt", "Attempt to decrypt !enc: message text using the saved Firebase UID")
  .option("--include-raw", "Include full raw Firestore document payloads")
  .action(async (options: { kin: string; limit: string; decrypt?: boolean; includeRaw?: boolean }) => {
    const { config, logger } = loadRuntime();
    const client = new FirestoreRestClient(config, logger);
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("--limit must be an integer from 1 to 100.");
    }

    const session = options.decrypt ? loadBrowserSession(config.bridge.sessionDir) : null;
    const decryptionKey = options.decrypt ? config.kindroid.uid || session?.firebaseAuth?.uid : undefined;
    if (options.decrypt && !decryptionKey) {
      throw new Error("Cannot decrypt without a Firebase UID. Run npm run session-info to verify the saved session.");
    }

    const documents = await client.listChatMessages({ kinId: options.kin, limit });
    const messages = documents.map((document) => {
      const message = mapKindroidMessage(document, options.kin, { decryptionKey });
      return options.includeRaw ? message : { ...message, raw: undefined };
    });
    process.stdout.write(`${JSON.stringify({ count: messages.length, messages }, null, 2)}\n`);
  });

program
  .command("listen")
  .description("Listen for new chat messages for a configured Kin.")
  .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
  .option("--page-size <count>", "Recent Firestore documents used to establish the initial listen target", "50")
  .action(async (options: { kin: string; pageSize: string }) => {
    const { config, logger } = loadRuntime();
    const pageSize = Number(options.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error("--page-size must be an integer from 1 to 100.");
    }

    const hermes = createHermesAdapter(config, logger);
    const dedupeStore = await createDedupeStore(config.bridge.sqlitePath, config.bridge.dedupeWindowSeconds);
    const listener = new KindroidChatListener(config, hermes, dedupeStore, logger);
    await listener.start({ kinId: options.kin, pageSize });
  });

program
  .command("monitor-live")
  .description("Monitor one Kin and print decrypted incoming Firestore chat messages as JSON lines.")
  .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
  .option("--page-size <count>", "Recent Firestore documents used to establish the initial listen target", "50")
  .option("--include-raw", "Include full raw Firestore document payloads")
  .action(async (options: { kin: string; pageSize: string; includeRaw?: boolean }) => {
    const { config, logger } = loadRuntime();
    const pageSize = Number(options.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error("--page-size must be an integer from 1 to 100.");
    }

    const monitor = new KindroidLiveMonitor(config, logger);
    await monitor.start({
      kinId: options.kin,
      pageSize,
      includeRaw: options.includeRaw
    });
  });

program
  .command("send")
  .description("Send one message to Kindroid through the observed REST endpoint.")
  .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
  .requiredOption("--message <message>", "Message text to send")
  .action(async (options: { kin: string; message: string }) => {
    const { config, logger } = loadRuntime();
    const client = new KindroidClient(config, logger);
    const dedupeStore = await createDedupeStore(config.bridge.sqlitePath, config.bridge.dedupeWindowSeconds);
    const requestId = newRequestId();
    const idempotencyKey = newRequestId();

    const result = await client.sendMessage({
      aiId: options.kin,
      message: options.message,
      requestId,
      idempotencyKey
    });

    if (result.ok) {
      await dedupeStore.recordOutbound({
        kinId: options.kin,
        text: options.message,
        requestId,
        idempotencyKey
      });
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: result.ok,
        status: result.status,
        requestId: result.requestId,
        idempotencyKey: result.idempotencyKey,
        error: result.ok || !result.responseText ? undefined : redactSecrets(result.responseText)
      })}\n`
    );

    if (!result.ok) {
      process.exitCode = 1;
    }
  });

program
  .command("daemon")
  .description("Run enabled bridge listeners.")
  .action(async () => {
    const { config, logger } = loadRuntime();
    const enabledKins = config.kindroid.kins.filter((kin) => kin.enabled);

    if (enabledKins.length === 0) {
      throw new Error("No enabled Kins configured. Add one to config.yaml or use npm run listen -- --kin <ai_id>.");
    }

    const missingAiId = enabledKins.find((kin) => !kin.aiId);
    if (missingAiId) {
      throw new Error(`Enabled Kin "${missingAiId.name}" is missing aiId.`);
    }

    const hermes = createHermesAdapter(config, logger);
    const dedupeStore = await createDedupeStore(config.bridge.sqlitePath, config.bridge.dedupeWindowSeconds);
    const listener = new KindroidChatListener(config, hermes, dedupeStore, logger);

    await Promise.all(
      enabledKins.map((kin) => {
        logger.info("Starting configured Kin listener.", { name: kin.name, aiId: kin.aiId });
        return listener.start({ kinId: kin.aiId });
      })
    );
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${redactSecrets(message)}\n`);
  process.exitCode = 1;
});

function loadRuntime() {
  const globalOptions = program.opts<{ config?: string }>();
  const config = loadConfig({ configPath: globalOptions.config });
  const logger = createLogger(config.bridge.logLevel);
  return { config, logger };
}
