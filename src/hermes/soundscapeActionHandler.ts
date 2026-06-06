import type { KindroidChatNotification } from "../firestore/types.js";
import { normalizeSoundscapeState } from "../soundscape/ProceduralLayers.js";
import type {
  ProceduralLayerDescriptor,
  ProceduralLayerType,
  SoundscapeState,
  SoundscapeTransition
} from "../soundscape/SoundscapeState.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface ScopedSoundscapeUpdate {
  scope: "kin" | "group";
  kinId?: string;
  groupId?: string;
  documentId: string;
  reason?: string;
  state: SoundscapeState;
}

export interface UpdateSoundscapeAction {
  type: "update_soundscape";
  ai_id?: string;
  reason?: string;
  soundscape: SoundscapeState;
}

export interface UpdateGroupSoundscapeAction {
  type: "update_group_soundscape";
  group_id?: string;
  reason?: string;
  soundscape: SoundscapeState;
}

type SoundscapeAction = UpdateSoundscapeAction | UpdateGroupSoundscapeAction;

export type SoundscapePreference = (notification: KindroidChatNotification) => boolean;

const layerTypes = new Set<ProceduralLayerType>([
  "rain",
  "wind",
  "roomTone",
  "lowDrone",
  "hum",
  "tensionPulse",
  "static"
]);
const transitions = new Set<SoundscapeTransition>(["hold", "fade", "swell", "drop_to_silence"]);

export class SoundscapeActionHandler implements HermesActionHandler<SoundscapeAction> {
  constructor(
    private readonly logger: Logger,
    private readonly onSoundscapeUpdated?: (update: ScopedSoundscapeUpdate) => void,
    private readonly isEnabled: SoundscapePreference = () => false
  ) {}

  promptLines(): string[] {
    return [
      'For direct Kin local ambience, you may request: {"type":"update_soundscape","ai_id":"<same direct chat ai_id>","reason":"<short reason>","soundscape":{"enabled":true,"environment":"<brief place or ambience>","mood":"<calm|melancholy|uneasy|tense|...>","intensity":0.4,"transition":"fade","layers":[{"type":"rain","volume":0.45,"density":0.5,"warmth":0.4,"movement":0.3},{"type":"roomTone","volume":0.4}]}}.',
      'For group local ambience, you may request: {"type":"update_group_soundscape","group_id":"<same group_id>","reason":"<short reason>","soundscape":{"enabled":true,"environment":"<brief group scene ambience>","mood":"<mood>","intensity":0.4,"transition":"fade","layers":[...]}}.',
      "Soundscape actions are local control-plane metadata only. They do not write Kindroid memory, current_scene, chat text, or Kin-visible instructions.",
      "Use soundscape actions only when soundscapeContext.enabledForSource is true.",
      "Use soundscape actions only when venue, weather, machinery, environmental texture, tension, or a major scene event materially changes. Do not update on every turn.",
      "Allowed layer types: rain, wind, roomTone, lowDrone, hum, tensionPulse, static. Use audible cached-sample mixer volumes: primary beds usually 0.35-0.55, weather 0.4-0.65, and drones/hum usually 0.15-0.3.",
      "Use static only for explicit radio, signal, comms, scanner, television, or interference scenes. Do not use static for generic office, lobby, tension, or machinery ambience."
    ];
  }

  normalizeActions(decision: HermesActionDecision): SoundscapeAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): SoundscapeAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      const soundscape = parseSoundscapeState(record.soundscape);
      if (!soundscape) {
        return [];
      }

      if (record.type === "update_soundscape") {
        return [
          {
            type: "update_soundscape",
            ai_id: typeof record.ai_id === "string" ? record.ai_id : undefined,
            reason: typeof record.reason === "string" ? record.reason : undefined,
            soundscape
          }
        ];
      }

      if (record.type === "update_group_soundscape") {
        return [
          {
            type: "update_group_soundscape",
            group_id: typeof record.group_id === "string" ? record.group_id : undefined,
            reason: typeof record.reason === "string" ? record.reason : undefined,
            soundscape
          }
        ];
      }

      return [];
    });
  }

  async handle(notification: KindroidChatNotification, action: SoundscapeAction): Promise<void> {
    if (!this.isEnabled(notification)) {
      this.logger.debug("Ignoring Hermes soundscape action because soundscape is disabled for the source Kin.", {
        ...safeNotificationMeta(notification),
        actionType: action.type
      });
      return;
    }

    if (action.type === "update_group_soundscape") {
      this.handleGroupSoundscape(notification, action);
      return;
    }

    this.handleKinSoundscape(notification, action);
  }

  private handleKinSoundscape(notification: KindroidChatNotification, action: UpdateSoundscapeAction): void {
    if (notification.type !== "kindroid.chat.changed") {
      this.logger.debug("Ignoring direct soundscape action for non-direct chat.", safeNotificationMeta(notification));
      return;
    }

    const targetAiId = action.ai_id ?? notification.kinId;
    if (targetAiId !== notification.kinId) {
      this.logger.warn("Ignoring Hermes soundscape action for mismatched ai_id.", {
        expectedAiId: notification.kinId,
        requestedAiId: targetAiId
      });
      return;
    }

    this.logger.info("Hermes soundscape action accepted.", {
      aiId: notification.kinId,
      documentId: notification.documentId,
      environment: action.soundscape.environment,
      mood: action.soundscape.mood,
      layerCount: action.soundscape.layers.length,
      reason: action.reason
    });
    this.onSoundscapeUpdated?.({
      scope: "kin",
      kinId: notification.kinId,
      documentId: notification.documentId,
      reason: action.reason,
      state: action.soundscape
    });
  }

  private handleGroupSoundscape(notification: KindroidChatNotification, action: UpdateGroupSoundscapeAction): void {
    if (notification.type !== "kindroid.group_chat.changed") {
      this.logger.debug("Ignoring group soundscape action for non-group chat.", safeNotificationMeta(notification));
      return;
    }

    const targetGroupId = action.group_id ?? notification.groupId;
    if (targetGroupId !== notification.groupId) {
      this.logger.warn("Ignoring Hermes group soundscape action for mismatched group_id.", {
        expectedGroupId: notification.groupId,
        requestedGroupId: targetGroupId
      });
      return;
    }

    this.logger.info("Hermes group soundscape action accepted.", {
      groupId: notification.groupId,
      documentId: notification.documentId,
      environment: action.soundscape.environment,
      mood: action.soundscape.mood,
      layerCount: action.soundscape.layers.length,
      reason: action.reason
    });
    this.onSoundscapeUpdated?.({
      scope: "group",
      groupId: notification.groupId,
      documentId: notification.documentId,
      reason: action.reason,
      state: action.soundscape
    });
  }
}

function parseSoundscapeState(value: unknown): SoundscapeState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const layers = Array.isArray(record.layers) ? record.layers.flatMap(parseLayer) : [];
  if (layers.length === 0 && record.enabled !== false) {
    return null;
  }

  const transition =
    typeof record.transition === "string" && transitions.has(record.transition as SoundscapeTransition)
      ? (record.transition as SoundscapeTransition)
      : "fade";
  return normalizeSoundscapeState({
    enabled: record.enabled !== false,
    environment: typeof record.environment === "string" ? record.environment : "unspecified",
    mood: typeof record.mood === "string" ? record.mood : "neutral",
    intensity: numericValue(record.intensity, 0.25),
    transition,
    layers
  });
}

function parseLayer(value: unknown): ProceduralLayerDescriptor[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || !layerTypes.has(record.type as ProceduralLayerType)) {
    return [];
  }

  return [
    {
      type: record.type as ProceduralLayerType,
      volume: layerVolume(record.type as ProceduralLayerType, record.volume),
      density: optionalNumericValue(record.density),
      pitch: typeof record.pitch === "number" || typeof record.pitch === "string" ? record.pitch : undefined,
      warmth: optionalNumericValue(record.warmth),
      movement: optionalNumericValue(record.movement)
    }
  ];
}

function layerVolume(type: ProceduralLayerType, value: unknown): number {
  const parsed = numericValue(value, defaultLayerVolume(type));
  if (parsed <= 0) {
    return 0;
  }
  return Math.max(parsed, minimumLayerVolume(type));
}

function defaultLayerVolume(type: ProceduralLayerType): number {
  switch (type) {
    case "rain":
    case "wind":
      return 0.45;
    case "roomTone":
      return 0.4;
    case "hum":
      return 0.24;
    case "lowDrone":
    case "static":
    case "tensionPulse":
      return 0.18;
  }
}

function minimumLayerVolume(type: ProceduralLayerType): number {
  switch (type) {
    case "rain":
    case "wind":
    case "roomTone":
      return 0.35;
    case "hum":
      return 0.18;
    case "lowDrone":
    case "static":
    case "tensionPulse":
      return 0.12;
  }
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeNotificationMeta(notification: KindroidChatNotification) {
  return {
    type: notification.type,
    documentId: notification.documentId,
    kinId: "kinId" in notification ? notification.kinId : undefined,
    groupId: "groupId" in notification ? notification.groupId : undefined,
    aiId: "aiId" in notification ? notification.aiId : undefined,
    timestamp: notification.timestamp,
    sender: notification.sender,
    role: notification.role,
    textPresent: Boolean(notification.text),
    textEncrypted: notification.textEncrypted,
    textDecrypted: notification.textDecrypted,
    source: notification.source
  };
}
