import type { KindroidChatNotification } from "../firestore/types.js";
import type { GroupBackgroundSuggestion } from "../groupBackground/groupBackgroundSuggestionStore.js";
import type { GroupBackgroundContext } from "../hermes/groupBackgroundActionHandler.js";
import type { HermesAdapter } from "../hermes/types.js";
import { type KindroidGroup } from "../kindroid/client/index.js";
import {
  PrewarmCoordinatorBase,
  type PrewarmCoordinatorBaseOptions,
  type PrewarmTrigger
} from "./prewarmCoordinatorBase.js";

interface GroupBackgroundPrewarmCoordinatorOptions extends PrewarmCoordinatorBaseOptions {
  hermes: HermesAdapter;
  isEnabled: () => boolean;
  groupBackgroundContext: (group: KindroidGroup, latestSpeakerKinId: string | null) => GroupBackgroundContext;
}

export class GroupBackgroundPrewarmCoordinator extends PrewarmCoordinatorBase {
  constructor(private readonly options: GroupBackgroundPrewarmCoordinatorOptions) {
    super(options, {
      kind: "groupBackground",
      deferLabel: "group background",
      isRuntimeEnabled: options.isEnabled
    });
  }

  markReady(suggestion: GroupBackgroundSuggestion): void {
    this.markReadySource(
      { scope: "group", id: suggestion.groupId },
      { documentId: suggestion.sourceDocumentId, timestamp: suggestion.sourceTimestamp ?? null }
    );
  }

  async prewarmKin(): Promise<void> {
    return;
  }

  async prewarmGroup(
    group: KindroidGroup,
    notification: KindroidChatNotification | null,
    reason: string,
    input: { trigger?: PrewarmTrigger; force?: boolean } = {}
  ): Promise<void> {
    if (notification && notification.type !== "kindroid.group_chat.changed") {
      return;
    }
    if (reason === "activity") {
      return;
    }

    const source = { scope: "group" as const, id: group.groupId };
    if (!this.begin(source, input, this.options.isEnabled())) {
      return;
    }

    try {
      const initialContext = this.options.groupBackgroundContext(group, notification?.aiId ?? null);
      const scene = localSceneSnapshot(initialContext.localScene);
      const latestSpeakerKinId =
        notification?.aiId || scene?.latestSpeakerKinId || initialContext.latestSpeakerKinId || null;
      const context =
        latestSpeakerKinId === initialContext.latestSpeakerKinId
          ? initialContext
          : this.options.groupBackgroundContext(group, latestSpeakerKinId);
      const text = buildGroupBackgroundPrewarmText({
        displayName: group.name,
        context,
        triggerText: notification?.text ?? undefined
      });
      if (!text) {
        this.options.logger.debug("Skipping group background prewarm because no current local scene is available.", {
          groupId: group.groupId,
          reason
        });
        return;
      }

      this.options.logger.info("Starting Hermes group background prewarm.", {
        groupId: group.groupId,
        groupName: group.name,
        latestSpeakerKinId,
        reason,
        localSceneUpdatedAt: scene?.updatedAt,
        localSceneSourceDocumentId: scene?.sourceDocumentId
      });
      await this.options.hermes.prewarmGroupBackground?.({
        scope: "group",
        groupId: group.groupId,
        aiId: latestSpeakerKinId,
        documentId:
          input.trigger?.documentId ??
          scene?.sourceDocumentId ??
          `group-background-prewarm:${group.groupId}:${Date.now()}`,
        timestamp: input.trigger?.timestamp ?? scene?.sourceTimestamp ?? new Date().toISOString(),
        text,
        groupBackgroundContext: context,
        forceProposal: Boolean(input.force)
      });
      this.markAttempt(source, input.trigger ?? sceneTrigger(scene));
    } catch (error) {
      this.options.logger.warn("Hermes group background prewarm setup failed.", {
        groupId: group.groupId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.finish(source);
    }
  }
}

export function buildGroupBackgroundPrewarmText(input: {
  displayName: string;
  context: GroupBackgroundContext;
  triggerText?: string;
}): string | null {
  const scene = localSceneSnapshot(input.context.localScene);
  if (!scene) {
    return null;
  }

  const participants = (input.context.participants ?? [])
    .map((participant) => participant.name || participant.aiId)
    .filter(Boolean)
    .join(", ");

  return [
    "GROUP_BACKGROUND_PREWARM_REQUEST",
    "Consider whether this group chat needs a reviewed background image prompt from the current local scene snapshot.",
    `Source: ${input.displayName}.`,
    participants ? `Participants for broad context only: ${participants}.` : "",
    "Use the current local scene snapshot as the source of truth. Do not reconstruct the setting from older chat turns.",
    "Return propose_group_background_image only when this scene snapshot is substantial, stable enough to depict, and different enough to justify a fresh background. Return no non-background actions.",
    "The prompt should describe environment and ambience for chat wallpaper. Avoid portraits, text, logos, UI, private identifiers, and explicit gore.",
    "Current local scene snapshot:",
    ...sceneLines(scene),
    input.triggerText ? `Latest trigger message, for recency only: ${truncateText(input.triggerText)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

interface LocalSceneSnapshot {
  location?: string;
  timeOfDay?: string;
  mood?: string;
  activity?: string;
  tension?: number;
  privacy?: string;
  visualPalette?: Record<string, unknown>;
  evidence?: string[];
  reason?: string;
  latestSpeakerKinId?: string | null;
  updatedAt?: string;
  sourceDocumentId?: string;
  sourceTimestamp?: string | null;
}

function localSceneSnapshot(value: unknown): LocalSceneSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const snapshot: LocalSceneSnapshot = {
    location: stringValue(record.location),
    timeOfDay: stringValue(record.timeOfDay),
    mood: stringValue(record.mood),
    activity: stringValue(record.activity),
    tension: typeof record.tension === "number" ? record.tension : undefined,
    privacy: stringValue(record.privacy),
    visualPalette: objectValue(record.visualPalette),
    evidence: stringArray(record.evidence),
    reason: stringValue(record.reason),
    latestSpeakerKinId: stringValue(record.latestSpeakerKinId) ?? null,
    updatedAt: stringValue(record.updatedAt),
    sourceDocumentId: stringValue(record.sourceDocumentId),
    sourceTimestamp: stringValue(record.sourceTimestamp) ?? null
  };

  return snapshot.location || snapshot.activity || snapshot.mood || snapshot.visualPalette ? snapshot : null;
}

function sceneLines(scene: LocalSceneSnapshot): string[] {
  return [
    scene.location ? `- Location: ${scene.location}` : "",
    scene.timeOfDay ? `- Time of day: ${scene.timeOfDay}` : "",
    scene.mood ? `- Mood: ${scene.mood}` : "",
    scene.activity ? `- Activity: ${scene.activity}` : "",
    typeof scene.tension === "number" ? `- Tension: ${scene.tension}` : "",
    scene.privacy ? `- Privacy: ${scene.privacy}` : "",
    scene.visualPalette ? `- Visual palette: ${metadataText(scene.visualPalette)}` : "",
    scene.reason ? `- Scene reason: ${scene.reason}` : "",
    scene.evidence && scene.evidence.length > 0 ? `- Evidence: ${scene.evidence.join("; ")}` : "",
    scene.updatedAt ? `- Scene updated at: ${scene.updatedAt}` : ""
  ].filter(Boolean);
}

function sceneTrigger(scene: LocalSceneSnapshot | null): PrewarmTrigger | undefined {
  return scene?.sourceDocumentId
    ? { documentId: scene.sourceDocumentId, timestamp: scene.sourceTimestamp ?? null }
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function metadataText(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join(", ");
}

function truncateText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
}
