import type { CampaignPack, MysteryEntry } from "./campaignPack.js";
import type { GameKeeperDecision, GameStateChange, GroupCampaignState } from "./campaignStateStore.js";
import { genericMysteryMoves, normalizeRollRequest } from "./gameMoves.js";

export function normalizeGameDecision(input: unknown, campaign: CampaignPack, mysteryId: string): GameKeeperDecision {
  const record = objectRecord(input);
  if (!record) {
    return { stateChanges: [] };
  }

  const mystery = campaign.mysteries.find((item) => item.id === mysteryId) ?? campaign.mysteries[0];
  const keeperMessage = optionalText(record.keeperMessage, 1400);
  const moveCall = plainObject(record.moveCall);
  const rollRequest = normalizeRollRequest(record.rollRequest ?? record.roll_request, genericMysteryMoves);
  return {
    ...(keeperMessage ? { keeperMessage } : {}),
    stateChanges: normalizeStateChanges(record.stateChanges, campaign, mystery),
    ...(moveCall ? { moveCall } : {}),
    ...(rollRequest ? { rollRequest } : {}),
    ...(normalizePressureCategory(record.pressureCategory ?? record.pressure_category)
      ? { pressureCategory: normalizePressureCategory(record.pressureCategory ?? record.pressure_category) }
      : {}),
    ...(normalizeConfidence(record.confidence) ? { confidence: normalizeConfidence(record.confidence) } : {}),
    ...(optionalText(record.reason, 300) ? { reason: optionalText(record.reason, 300) } : {})
  };
}

export function parseGameDecisionContent(content: string): unknown {
  const jsonText = extractJsonObject(content.trim());
  if (!jsonText) {
    return {};
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return {};
  }
}

function normalizeStateChanges(
  value: unknown,
  campaign: CampaignPack,
  mystery: MysteryEntry | undefined
): GameStateChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): GameStateChange[] => {
    const record = objectRecord(item);
    if (!record) {
      return [];
    }

    if (record.type === "advance_countdown") {
      return [
        { type: "advance_countdown", by: optionalInteger(record.by, 1, 3), reason: optionalText(record.reason, 220) }
      ];
    }

    if (record.type === "set_status") {
      const status = normalizeStatus(record.status);
      return status ? [{ type: "set_status", status, reason: optionalText(record.reason, 220) }] : [];
    }

    if (record.type === "add_discovered_clue") {
      const clueId = optionalText(record.clueId ?? record.clue_id, 120);
      return clueId && isKnownClue(mystery, clueId)
        ? [{ type: "add_discovered_clue", clueId, reason: optionalText(record.reason, 220) }]
        : [];
    }

    if (record.type === "reveal_threat") {
      const threatId = optionalText(record.threatId ?? record.threat_id, 120);
      return threatId && campaign.threats.some((threat) => threat.id === threatId)
        ? [{ type: "reveal_threat", threatId, reason: optionalText(record.reason, 220) }]
        : [];
    }

    if (record.type === "reveal_npc") {
      const npcId = optionalText(record.npcId ?? record.npc_id, 120);
      return npcId && campaign.npcs.some((npc) => npc.id === npcId)
        ? [{ type: "reveal_npc", npcId, reason: optionalText(record.reason, 220) }]
        : [];
    }

    if (record.type === "visit_location") {
      const locationId = optionalText(record.locationId ?? record.location_id, 120);
      return locationId && campaign.locations.some((location) => location.id === locationId)
        ? [{ type: "visit_location", locationId, reason: optionalText(record.reason, 220) }]
        : [];
    }

    if (record.type === "append_note") {
      const text = optionalText(record.text, 280);
      return text ? [{ type: "append_note", text }] : [];
    }

    return [];
  });
}

function isKnownClue(mystery: MysteryEntry | undefined, clueId: string): boolean {
  return Boolean(
    mystery?.clues.some((clue) => {
      return typeof clue === "string" ? clue === clueId : clue.id === clueId;
    })
  );
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return objectRecord(value) ?? undefined;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeStatus(value: unknown): GroupCampaignState["status"] | undefined {
  return value === "initialized" || value === "active" || value === "paused" || value === "completed"
    ? value
    : undefined;
}

function normalizeConfidence(value: unknown): GameKeeperDecision["confidence"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizePressureCategory(value: unknown): string | undefined {
  const normalized = optionalText(value, 80);
  const allowed = new Set([
    "foreshadow",
    "offscreen_pressure",
    "direct_danger",
    "investigation_prompt",
    "resource_pressure",
    "consequence_choice",
    "opportunity_with_cost",
    "loss_or_complication",
    "bystander_trouble",
    "threat_action",
    "scene_question"
  ]);
  return normalized && allowed.has(normalized) ? normalized : undefined;
}

function extractJsonObject(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}
