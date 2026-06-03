import type { Command } from "commander";
import {
  readChatDynamism,
  runChatDynamismExperiment,
  type RunChatDynamismExperimentOptions
} from "../experiments/chatDynamismExperiment.js";
import type { LoadRuntime } from "./types.js";

export function registerChatDynamismCommand(program: Command, loadRuntime: LoadRuntime): void {
  program
    .command("chat-dynamism")
    .description("Read a Kin's current Chat Dynamism field from Firestore REST.")
    .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
    .action(async (options: { kin: string }) => {
      const { config, logger } = loadRuntime();
      const report = await readChatDynamism(config, logger, options.kin);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  program
    .command("experiment-chat-dynamism")
    .description("Run a manual write/read/restore diagnostic for Kindroid Chat Dynamism.")
    .requiredOption("--kin <ai_id>", "Kindroid AI/Kin id")
    .option("--target <number>", "Candidate Chat Dynamism value")
    .option("--dry-run", "Print current value and sanitized payload preview without writing")
    .option("--restore", "Restore the original value after a write", true)
    .option("--no-restore", "Leave the target value in place; requires --force")
    .option("--request-id <id>", "Request id for the experiment")
    .option("--observe-seconds <number>", "Seconds to wait before re-reading", "3")
    .option("--method <method>", "Experiment method: update-info or firestore", "update-info")
    .option("--force", "Allow no-restore, unreadable current values, or out-of-bounds testing")
    .action(
      async (options: {
        kin: string;
        target?: string;
        dryRun?: boolean;
        restore?: boolean;
        requestId?: string;
        observeSeconds: string;
        method: string;
        force?: boolean;
      }) => {
        const method = normalizeMethod(options.method);
        const observeSeconds = Number(options.observeSeconds);
        const { config, logger } = loadRuntime();
        const report = await runChatDynamismExperiment(config, logger, {
          kinId: options.kin,
          target: options.target,
          dryRun: options.dryRun,
          restore: options.restore,
          requestId: options.requestId,
          observeSeconds,
          method,
          force: options.force
        } satisfies RunChatDynamismExperimentOptions);

        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.conclusion === "rejected") {
          process.exitCode = 1;
        }
      }
    );
}

function normalizeMethod(value: string): "update-info" | "firestore" {
  if (value === "update-info" || value === "firestore") {
    return value;
  }

  throw new Error("--method must be update-info or firestore.");
}
