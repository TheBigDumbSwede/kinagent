import type { RollResult } from "./gameMoves.js";

export function formatRollResultMessage(result: RollResult): string {
  return `Roll: ${rollOutcomeSummary(result)}.`;
}

export function rollOutcomeSummary(result: Pick<RollResult, "outcome" | "total">): string {
  if (result.total >= 12) {
    return "perfect success";
  }
  if (result.outcome === "10+") {
    return "success";
  }
  if (result.outcome === "7-9") {
    return "partial success with complication";
  }
  if (result.total <= 3) {
    return "critical failure";
  }
  return "failure with complication";
}
