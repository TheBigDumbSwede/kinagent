import type { Command } from "commander";
import { runInternetResponseExperiment } from "../experiments/internetResponseExperiment.js";
import type { LoadRuntime } from "./types.js";

export function registerInternetResponseExperimentCommand(program: Command, loadRuntime: LoadRuntime): void {
  program
    .command("experiment-internet-response")
    .description("Run a manual live diagnostic for Kindroid's undocumented internet_response send-message field.")
    .option("--kin <ai_id>", "Kindroid AI/Kin id for a direct chat diagnostic")
    .option("--group <group_id>", "Kindroid group id for a group chat diagnostic")
    .option("--message [message]", "Visible user message text to send")
    .option("--internet-response <text>", "Candidate hidden context for the internet_response field")
    .option("--internet-response-file <path>", "Read candidate hidden context from a UTF-8 text file")
    .option("--expect <text>", "Expected canary or fact to look for in the Kin response; can be repeated", collect, [])
    .option("--allow-empty-message", "Allow an empty visible message for this diagnostic")
    .option("--request-id <id>", "Request id for the experiment message")
    .option("--dry-run", "Print a sanitized payload preview without sending")
    .option("--include-control", "Send a paired control message without internet_response before the experiment")
    .option(
      "--trigger-group-response",
      "After a group user-message send, also call Kindroid's observed group get-turn and AI-response endpoints"
    )
    .option("--delay-ms <number>", "Delay between control and experiment sends", "15000")
    .option("--observe-seconds <number>", "Seconds to wait before fetching recent messages", "60")
    .option("--verbose-chat", "Include more decrypted recent chat text in the observation report")
    .action(
      async (options: {
        kin?: string;
        group?: string;
        message?: string | boolean;
        internetResponse?: string;
        internetResponseFile?: string;
        expect: string[];
        allowEmptyMessage?: boolean;
        requestId?: string;
        dryRun?: boolean;
        includeControl?: boolean;
        triggerGroupResponse?: boolean;
        delayMs: string;
        observeSeconds: string;
        verboseChat?: boolean;
      }) => {
        const { config, logger } = loadRuntime();
        const delayMs = Number(options.delayMs);
        const observeSeconds = Number(options.observeSeconds);
        const report = await runInternetResponseExperiment(config, logger, {
          kinId: options.kin,
          groupId: options.group,
          message: typeof options.message === "string" ? options.message : undefined,
          internetResponse: options.internetResponse,
          internetResponseFile: options.internetResponseFile,
          expectedTexts: options.expect,
          allowEmptyMessage: options.allowEmptyMessage,
          requestId: options.requestId,
          dryRun: options.dryRun,
          includeControl: options.includeControl,
          triggerGroupResponse: options.triggerGroupResponse,
          delayMs,
          observeSeconds,
          verboseChat: options.verboseChat
        });

        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.conclusion === "rejected") {
          process.exitCode = 1;
        }
      }
    );
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
