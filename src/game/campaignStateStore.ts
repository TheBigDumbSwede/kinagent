import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { CampaignPack, MysteryEntry } from "./campaignPack.js";
import type { RollRequest, RollResult } from "./gameMoves.js";
import type { GamingAutomationMode } from "./groupGamingPreferences.js";

export type GameDecisionConfidence = "low" | "medium" | "high";

export interface GameKeeperDecision {
  keeperMessage?: string;
  stateChanges: GameStateChange[];
  moveCall?: Record<string, unknown>;
  rollRequest?: RollRequest;
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
  pressureCategory?: string;
  confidence?: GameDecisionConfidence;
  reason?: string;
}

export interface PendingRollRequest {
  sourceDocumentId: string;
  createdAt: string;
  automationMode: GamingAutomationMode;
  request: RollRequest;
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

export interface StoredRollResult {
  sourceDocumentId: string;
  resolvedAt: string;
  automationMode: GamingAutomationMode;
  request: RollRequest;
  result: RollResult;
  message: string;
  sent?: {
    ok: boolean;
    status: number;
    requestId?: string;
    idempotencyKey?: string;
    responseText?: string;
  };
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
  processedSourceDocumentIds: string[];
  rollHistory: StoredRollResult[];
  pendingRollRequest?: PendingRollRequest;
  pendingDecision?: PendingGameDecision;
  lastKeeperMessage?: SentKeeperMessage;
}

const rollHistoryLimit = 24;

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
      notes: [],
      processedSourceDocumentIds: [],
      rollHistory: []
    };
    groups[input.groupId] = next;
    this.write({ ...file, groups });
    return next;
  }

  activate(input: {
    groupId: string;
    campaign: CampaignPack;
    mysteryId?: string;
    sourceDocumentId?: string;
  }): GroupCampaignState {
    const current = this.ensureInitialized({
      groupId: input.groupId,
      campaign: input.campaign,
      mysteryId: input.mysteryId
    });
    if (input.sourceDocumentId && isProcessedSourceDocument(current, input.sourceDocumentId)) {
      return current;
    }

    const now = new Date().toISOString();
    const updated: GroupCampaignState = {
      ...current,
      status: "active",
      updatedAt: now,
      processedSourceDocumentIds: input.sourceDocumentId
        ? appendProcessedSourceDocumentId(current.processedSourceDocumentIds, input.sourceDocumentId)
        : current.processedSourceDocumentIds
    };
    this.saveGroupState(input.groupId, updated);
    return updated;
  }

  resetInitialized(input: {
    groupId: string;
    campaign: CampaignPack;
    mysteryId?: string;
    sourceDocumentId?: string;
  }): GroupCampaignState {
    const mystery = findMystery(input.campaign, input.mysteryId);
    const file = this.read();
    const groups = file.groups ?? {};
    const previous = groups[input.groupId];
    if (
      input.sourceDocumentId &&
      previous?.campaignId === input.campaign.id &&
      previous.mysteryId === mystery.id &&
      isProcessedSourceDocument(stateWithDefaults(previous), input.sourceDocumentId)
    ) {
      return stateWithDefaults(previous);
    }

    const now = new Date().toISOString();
    const next = initialGroupCampaignState({
      groupId: input.groupId,
      campaignId: input.campaign.id,
      mysteryId: mystery.id,
      status: "active",
      now,
      processedSourceDocumentIds: input.sourceDocumentId
        ? appendProcessedSourceDocumentId([], input.sourceDocumentId)
        : []
    });
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
    if (isProcessedSourceDocument(current, input.sourceDocumentId)) {
      return current;
    }
    const next = applyStateChanges(current, input.decision.stateChanges, mystery, now);
    const pendingDecision = pendingDecisionFrom(input, now);
    const pendingRollRequest = pendingRollRequestFrom(input, now) ?? next.pendingRollRequest;
    const updated: GroupCampaignState = {
      ...next,
      updatedAt: now,
      processedSourceDocumentIds: appendProcessedSourceDocumentId(
        next.processedSourceDocumentIds,
        input.sourceDocumentId
      ),
      ...(pendingRollRequest ? { pendingRollRequest } : {}),
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

  recordRollResult(input: {
    groupId: string;
    sourceDocumentId: string;
    automationMode: GamingAutomationMode;
    request: RollRequest;
    result: RollResult;
    message: string;
    sent?: StoredRollResult["sent"];
  }): GroupCampaignState | null {
    const current = this.getForGroup(input.groupId);
    if (!current) {
      return null;
    }

    const entry: StoredRollResult = {
      sourceDocumentId: input.sourceDocumentId,
      resolvedAt: new Date().toISOString(),
      automationMode: input.automationMode,
      request: input.request,
      result: input.result,
      message: input.message,
      ...(input.sent ? { sent: input.sent } : {})
    };
    const updated: GroupCampaignState = {
      ...current,
      pendingRollRequest: undefined,
      rollHistory: [...current.rollHistory, entry].slice(-rollHistoryLimit),
      updatedAt: entry.resolvedAt
    };
    this.saveGroupState(input.groupId, updated);
    return updated;
  }

  markRollResultSent(input: {
    groupId: string;
    sourceDocumentId: string;
    message: string;
    sent: StoredRollResult["sent"];
  }): GroupCampaignState | null {
    const current = this.getForGroup(input.groupId);
    if (!current) {
      return null;
    }

    let index = -1;
    for (let candidate = current.rollHistory.length - 1; candidate >= 0; candidate -= 1) {
      if (current.rollHistory[candidate]?.sourceDocumentId === input.sourceDocumentId) {
        index = candidate;
        break;
      }
    }
    if (index < 0) {
      return current;
    }

    const updatedHistory = [...current.rollHistory];
    updatedHistory[index] = {
      ...updatedHistory[index],
      message: input.message,
      ...(input.sent ? { sent: input.sent } : {})
    };
    const updated: GroupCampaignState = {
      ...current,
      rollHistory: updatedHistory,
      updatedAt: new Date().toISOString()
    };
    this.saveGroupState(input.groupId, updated);
    return updated;
  }

  storePendingKeeperDecision(input: {
    groupId: string;
    sourceDocumentId: string;
    automationMode: GamingAutomationMode;
    keeperMessage: string;
    confidence?: GameDecisionConfidence;
    reason?: string;
  }): GroupCampaignState | null {
    const current = this.getForGroup(input.groupId);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: GroupCampaignState = {
      ...current,
      pendingDecision: {
        sourceDocumentId: input.sourceDocumentId,
        createdAt: now,
        automationMode: input.automationMode,
        keeperMessage: input.keeperMessage,
        ...(input.confidence ? { confidence: input.confidence } : {}),
        ...(input.reason ? { reason: input.reason } : {})
      },
      updatedAt: now
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

function initialGroupCampaignState(input: {
  groupId: string;
  campaignId: string;
  mysteryId: string;
  status: GroupCampaignState["status"];
  now: string;
  processedSourceDocumentIds?: string[];
}): GroupCampaignState {
  return {
    groupId: input.groupId,
    campaignId: input.campaignId,
    mysteryId: input.mysteryId,
    status: input.status,
    initializedAt: input.now,
    updatedAt: input.now,
    currentCountdownIndex: 0,
    discoveredClueIds: [],
    revealedThreatIds: [],
    revealedNpcIds: [],
    visitedLocationIds: [],
    notes: [],
    processedSourceDocumentIds: input.processedSourceDocumentIds ?? [],
    rollHistory: []
  };
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
  if (input.automationMode === "observe") {
    return undefined;
  }
  if (!decision.keeperMessage && !decision.moveCall) {
    return undefined;
  }

  return {
    sourceDocumentId: input.sourceDocumentId,
    createdAt,
    automationMode: input.automationMode,
    ...(decision.keeperMessage ? { keeperMessage: decision.keeperMessage } : {}),
    ...(decision.moveCall ? { moveCall: decision.moveCall } : {}),
    ...(decision.pressureCategory ? { pressureCategory: decision.pressureCategory } : {}),
    ...(decision.confidence ? { confidence: decision.confidence } : {}),
    ...(decision.reason ? { reason: decision.reason } : {})
  };
}

function pendingRollRequestFrom(
  input: {
    sourceDocumentId: string;
    automationMode: GamingAutomationMode;
    decision: GameKeeperDecision;
  },
  createdAt: string
): PendingRollRequest | undefined {
  const request = input.decision.rollRequest;
  if (!request) {
    return undefined;
  }

  return {
    sourceDocumentId: input.sourceDocumentId,
    createdAt,
    automationMode: input.automationMode,
    request,
    ...(input.decision.confidence ? { confidence: input.decision.confidence } : {}),
    ...(input.decision.reason ? { reason: input.decision.reason } : {})
  };
}

function uniqueAppend(values: string[], value: string): string[] {
  const normalized = value.trim();
  return normalized && !values.includes(normalized) ? [...values, normalized] : values;
}

function isProcessedSourceDocument(state: GroupCampaignState, sourceDocumentId: string): boolean {
  const normalized = sourceDocumentId.trim();
  return Boolean(normalized && state.processedSourceDocumentIds.includes(normalized));
}

function appendProcessedSourceDocumentId(values: string[], sourceDocumentId: string): string[] {
  const normalized = sourceDocumentId.trim();
  if (!normalized) {
    return values.slice(-100);
  }
  return uniqueAppend(values, normalized).slice(-100);
}

function stateWithDefaults(state: GroupCampaignState): GroupCampaignState {
  const currentState = { ...state } as GroupCampaignState & { turnGuard?: unknown };
  delete currentState.turnGuard;
  return {
    ...currentState,
    discoveredClueIds: state.discoveredClueIds ?? [],
    revealedThreatIds: state.revealedThreatIds ?? [],
    revealedNpcIds: state.revealedNpcIds ?? [],
    visitedLocationIds: state.visitedLocationIds ?? [],
    notes: state.notes ?? [],
    processedSourceDocumentIds: state.processedSourceDocumentIds ?? [],
    rollHistory: state.rollHistory ?? [],
    ...(state.pendingRollRequest ? { pendingRollRequest: state.pendingRollRequest } : {}),
    ...(state.pendingDecision ? { pendingDecision: state.pendingDecision } : {}),
    ...(state.lastKeeperMessage ? { lastKeeperMessage: state.lastKeeperMessage } : {})
  };
}
