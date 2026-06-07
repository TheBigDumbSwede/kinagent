import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { CampaignPack, MysteryEntry } from "./campaignPack.js";
import type { GamingAutomationMode } from "./groupGamingPreferences.js";

export type GameDecisionConfidence = "low" | "medium" | "high";

export interface GameKeeperDecision {
  keeperMessage?: string;
  stateChanges: GameStateChange[];
  moveCall?: Record<string, unknown>;
  rollRequest?: Record<string, unknown>;
  pressureCategory?: string;
  confidence?: GameDecisionConfidence;
  reason?: string;
}

export type GameStateChange =
  | { type: "advance_countdown"; by?: number; reason?: string }
  | { type: "set_status"; status: GroupCampaignState["status"]; reason?: string }
  | { type: "add_discovered_clue"; clueId: string; reason?: string }
  | { type: "reveal_threat"; threatId: string; reason?: string }
  | { type: "reveal_npc"; npcId: string; reason?: string }
  | { type: "visit_location"; locationId: string; reason?: string }
  | { type: "append_note"; text: string };

export interface PendingGameDecision {
  sourceDocumentId: string;
  createdAt: string;
  automationMode: GamingAutomationMode;
  keeperMessage?: string;
  moveCall?: Record<string, unknown>;
  rollRequest?: Record<string, unknown>;
  pressureCategory?: string;
  confidence?: GameDecisionConfidence;
  reason?: string;
}

export interface SentKeeperMessage {
  text: string;
  sentAt: string;
  requestId: string;
  idempotencyKey: string;
  sourceDocumentId: string;
}

export interface GroupCampaignState {
  groupId: string;
  campaignId: string;
  mysteryId: string;
  status: "initialized" | "active" | "paused" | "completed";
  initializedAt: string;
  updatedAt: string;
  currentCountdownIndex: number;
  discoveredClueIds: string[];
  revealedThreatIds: string[];
  revealedNpcIds: string[];
  visitedLocationIds: string[];
  notes: string[];
  pendingDecision?: PendingGameDecision;
  lastKeeperMessage?: SentKeeperMessage;
}

interface CampaignStateFile {
  groups?: Record<string, GroupCampaignState>;
}

export class CampaignStateStore {
  constructor(private readonly filePath: string) {}

  static fromConfig(config: AppConfig): CampaignStateStore {
    return new CampaignStateStore(campaignStatePath(config));
  }

  getForGroup(groupId: string): GroupCampaignState | null {
    const state = this.read().groups?.[groupId];
    return state ? stateWithDefaults(state) : null;
  }

  ensureInitialized(input: { groupId: string; campaign: CampaignPack; mysteryId?: string }): GroupCampaignState {
    const mystery = findMystery(input.campaign, input.mysteryId);
    const file = this.read();
    const groups = file.groups ?? {};
    const previous = groups[input.groupId];
    if (previous?.campaignId === input.campaign.id && previous.mysteryId === mystery.id) {
      return stateWithDefaults(previous);
    }

    const now = new Date().toISOString();
    const next: GroupCampaignState = {
      groupId: input.groupId,
      campaignId: input.campaign.id,
      mysteryId: mystery.id,
      status: "initialized",
      initializedAt: now,
      updatedAt: now,
      currentCountdownIndex: 0,
      discoveredClueIds: [],
      revealedThreatIds: [],
      revealedNpcIds: [],
      visitedLocationIds: [],
      notes: []
    };
    groups[input.groupId] = next;
    this.write({ ...file, groups });
    return next;
  }

  applyDecision(input: {
    groupId: string;
    campaign: CampaignPack;
    mysteryId?: string;
    sourceDocumentId: string;
    automationMode: GamingAutomationMode;
    decision: GameKeeperDecision;
  }): GroupCampaignState {
    const current = this.ensureInitialized({
      groupId: input.groupId,
      campaign: input.campaign,
      mysteryId: input.mysteryId
    });
    const mystery = findMystery(input.campaign, current.mysteryId);
    const now = new Date().toISOString();
    const next = applyStateChanges(current, input.decision.stateChanges, mystery, now);
    const pendingDecision = pendingDecisionFrom(input, now);
    const updated: GroupCampaignState = {
      ...next,
      updatedAt: now,
      ...(pendingDecision ? { pendingDecision } : { pendingDecision: undefined })
    };

    this.saveGroupState(input.groupId, updated);
    return updated;
  }

  markKeeperMessageSent(input: {
    groupId: string;
    text: string;
    requestId: string;
    idempotencyKey: string;
    sourceDocumentId: string;
  }): GroupCampaignState | null {
    const current = this.getForGroup(input.groupId);
    if (!current) {
      return null;
    }

    const updated: GroupCampaignState = {
      ...current,
      pendingDecision: undefined,
      lastKeeperMessage: {
        text: input.text,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        sourceDocumentId: input.sourceDocumentId,
        sentAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    };
    this.saveGroupState(input.groupId, updated);
    return updated;
  }

  private read(): CampaignStateFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as CampaignStateFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(file: CampaignStateFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(sortStateFile(file), null, 2)}\n`, "utf8");
  }

  private saveGroupState(groupId: string, state: GroupCampaignState): void {
    const file = this.read();
    const groups = file.groups ?? {};
    groups[groupId] = state;
    this.write({ ...file, groups });
  }
}

export function campaignStatePath(config: AppConfig): string {
  return path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "game-campaign-state.json");
}

function findMystery(campaign: CampaignPack, mysteryId: string | undefined): MysteryEntry {
  const mystery = mysteryId ? campaign.mysteries.find((item) => item.id === mysteryId) : campaign.mysteries[0];
  if (!mystery) {
    throw new Error(`Campaign mystery not found: ${mysteryId ?? "(first mystery)"}`);
  }
  return mystery;
}

function sortStateFile(file: CampaignStateFile): CampaignStateFile {
  const groups = Object.fromEntries(
    Object.entries(file.groups ?? {}).sort(([left], [right]) => left.localeCompare(right))
  );
  return { groups };
}

function applyStateChanges(
  state: GroupCampaignState,
  changes: GameStateChange[],
  mystery: MysteryEntry,
  updatedAt: string
): GroupCampaignState {
  return changes.reduce((current, change) => applyStateChange(current, change, mystery, updatedAt), state);
}

function applyStateChange(
  state: GroupCampaignState,
  change: GameStateChange,
  mystery: MysteryEntry,
  updatedAt: string
): GroupCampaignState {
  if (change.type === "advance_countdown") {
    const by = Math.max(1, Math.min(3, Math.trunc(change.by ?? 1)));
    return {
      ...state,
      currentCountdownIndex: Math.min(mystery.countdown.length, state.currentCountdownIndex + by),
      updatedAt
    };
  }

  if (change.type === "set_status") {
    return { ...state, status: change.status, updatedAt };
  }

  if (change.type === "add_discovered_clue") {
    return { ...state, discoveredClueIds: uniqueAppend(state.discoveredClueIds, change.clueId), updatedAt };
  }

  if (change.type === "reveal_threat") {
    return { ...state, revealedThreatIds: uniqueAppend(state.revealedThreatIds, change.threatId), updatedAt };
  }

  if (change.type === "reveal_npc") {
    return { ...state, revealedNpcIds: uniqueAppend(state.revealedNpcIds, change.npcId), updatedAt };
  }

  if (change.type === "visit_location") {
    return { ...state, visitedLocationIds: uniqueAppend(state.visitedLocationIds, change.locationId), updatedAt };
  }

  return { ...state, notes: uniqueAppend(state.notes, change.text).slice(-24), updatedAt };
}

function pendingDecisionFrom(
  input: {
    sourceDocumentId: string;
    automationMode: GamingAutomationMode;
    decision: GameKeeperDecision;
  },
  createdAt: string
): PendingGameDecision | undefined {
  const decision = input.decision;
  if (!decision.keeperMessage && !decision.moveCall && !decision.rollRequest) {
    return undefined;
  }

  return {
    sourceDocumentId: input.sourceDocumentId,
    createdAt,
    automationMode: input.automationMode,
    ...(decision.keeperMessage ? { keeperMessage: decision.keeperMessage } : {}),
    ...(decision.moveCall ? { moveCall: decision.moveCall } : {}),
    ...(decision.rollRequest ? { rollRequest: decision.rollRequest } : {}),
    ...(decision.pressureCategory ? { pressureCategory: decision.pressureCategory } : {}),
    ...(decision.confidence ? { confidence: decision.confidence } : {}),
    ...(decision.reason ? { reason: decision.reason } : {})
  };
}

function uniqueAppend(values: string[], value: string): string[] {
  const normalized = value.trim();
  return normalized && !values.includes(normalized) ? [...values, normalized] : values;
}

function stateWithDefaults(state: GroupCampaignState): GroupCampaignState {
  return {
    ...state,
    discoveredClueIds: state.discoveredClueIds ?? [],
    revealedThreatIds: state.revealedThreatIds ?? [],
    revealedNpcIds: state.revealedNpcIds ?? [],
    visitedLocationIds: state.visitedLocationIds ?? [],
    notes: state.notes ?? []
  };
}
