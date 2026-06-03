import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { ambientContextTones, buildAmbientContextTurn, type AmbientContextTone } from "../kindroid/ambientContext.js";
import { KindroidClient } from "../kindroid/kindroidClient.js";
import { buildSendMessagePayload } from "../kindroid/payloads.js";
import { createDedupeStore } from "../state/sqliteStore.js";
import { newRequestId } from "../util/ids.js";
import { redactSecrets } from "../util/logger.js";
import type { LoadRuntime } from "./types.js";

export function registerAmbientContextCommand(program: Command, loadRuntime: LoadRuntime): void {
  program
    .command("ambient-context")
    .description("Send a visible ambient turn with hidden operational context attached through internet_response.")
    .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
    .option("--context <text>", "Hidden operational context to attach")
    .option("--context-file <path>", "Read hidden operational context from a UTF-8 text file")
    .option("--tone <tone>", `Ambient tone (${ambientContextTones.join("|")})`, "neutral")
    .option("--ambient-message <text>", "Visible atmospheric message generated for this turn")
    .option("--visible-message <text>", "Compatibility alias for --ambient-message")
    .option("--instruction <text>", "Override the hidden context instruction")
    .option("--dry-run", "Print a sanitized preview without sending")
    .option("--request-id <id>", "Request id for the ambient context message")
    .option("--idempotency-key <key>", "Idempotency key for the ambient context message")
    .option("--verbose", "Include the redacted hidden context packet in command output")
    .action(
      async (options: {
        kin: string;
        context?: string;
        contextFile?: string;
        tone: string;
        ambientMessage?: string;
        visibleMessage?: string;
        instruction?: string;
        dryRun?: boolean;
        requestId?: string;
        idempotencyKey?: string;
        verbose?: boolean;
      }) => {
        const { config, logger } = loadRuntime();
        const tone = parseAmbientTone(options.tone);
        const context = readAmbientContext(options.context, options.contextFile);
        const ambientMessage = readAmbientMessage(options.ambientMessage, options.visibleMessage);
        const turn = buildAmbientContextTurn({
          tone,
          context,
          ambientMessage,
          instruction: options.instruction
        });
        const requestId = options.requestId?.trim() || newRequestId();
        const idempotencyKey = options.idempotencyKey?.trim() || newRequestId();

        const baseReport = {
          type: "kindroid.ambient_context_turn",
          dryRun: Boolean(options.dryRun),
          kinId: options.kin,
          tone: turn.tone,
          visibleMessage: turn.visibleMessage,
          hiddenContextLength: turn.internetResponse.length,
          requestId,
          idempotencyKey,
          internetResponse: options.verbose ? redactSecrets(turn.internetResponse) : undefined
        };

        if (options.dryRun) {
          process.stdout.write(
            `${JSON.stringify(
              {
                ...baseReport,
                payloadPreview: previewAmbientPayload({
                  aiId: options.kin,
                  message: turn.visibleMessage,
                  requestId,
                  idempotencyKey,
                  internetResponse: turn.internetResponse
                })
              },
              null,
              2
            )}\n`
          );
          return;
        }

        const client = new KindroidClient(config, logger);
        const dedupeStore = await createDedupeStore(config.bridge.sqlitePath, config.bridge.dedupeWindowSeconds);
        await dedupeStore.recordOutbound({
          kinId: options.kin,
          text: turn.visibleMessage,
          requestId,
          idempotencyKey
        });

        const result = await client.sendMessage({
          aiId: options.kin,
          message: turn.visibleMessage,
          requestId,
          idempotencyKey,
          internetResponse: turn.internetResponse
        });

        process.stdout.write(
          `${JSON.stringify(
            {
              ...baseReport,
              ok: result.ok,
              status: result.status,
              error: result.ok || !result.responseText ? undefined : redactSecrets(result.responseText)
            },
            null,
            2
          )}\n`
        );

        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );
}

function parseAmbientTone(value: string): AmbientContextTone {
  if (ambientContextTones.includes(value as AmbientContextTone)) {
    return value as AmbientContextTone;
  }

  throw new Error(`--tone must be one of: ${ambientContextTones.join(", ")}.`);
}

function readAmbientContext(context: string | undefined, contextFile: string | undefined): string {
  if (context?.trim() && contextFile?.trim()) {
    throw new Error("Use either --context or --context-file, not both.");
  }

  const value = contextFile?.trim() ? fs.readFileSync(path.resolve(process.cwd(), contextFile), "utf8") : context;
  if (!value?.trim()) {
    throw new Error("--context or --context-file is required.");
  }

  return value.trim();
}

function readAmbientMessage(
  ambientMessage: string | undefined,
  visibleMessage: string | undefined
): string | undefined {
  if (ambientMessage?.trim() && visibleMessage?.trim()) {
    throw new Error("Use either --ambient-message or --visible-message, not both.");
  }

  return ambientMessage?.trim() || visibleMessage?.trim() || undefined;
}

function previewAmbientPayload(input: Parameters<typeof buildSendMessagePayload>[0]): Record<string, unknown> {
  const payload = buildSendMessagePayload(input);
  return {
    ...payload,
    internet_response:
      typeof payload.internet_response === "string"
        ? `[REDACTED length=${payload.internet_response.length}]`
        : payload.internet_response
  };
}
