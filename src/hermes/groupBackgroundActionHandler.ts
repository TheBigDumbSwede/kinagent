import type {
  GroupBackgroundSuggestion,
  GroupBackgroundSuggestionStore
} from "../groupBackground/groupBackgroundSuggestionStore.js";
import type { KindroidChatNotification } from "../firestore/types.js";
import type { Logger } from "../util/logger.js";
import type { HermesActionDecision, HermesActionHandler } from "./currentSceneActionHandler.js";

export interface GroupBackgroundContext {
  enabledForSource: boolean;
  minSignificance: number;
  groupName?: string;
  latestSpeakerKinId?: string | null;
  participants?: Array<{ aiId: string; name?: string }>;
  localScene?: unknown;
  mutation?: "reviewed-prompt-only" | "autonomous-generate-apply";
}

export interface ProposeGroupBackgroundImageAction {
  type: "propose_group_background_image";
  group_id?: string;
  title: string;
  prompt: string;
  negative_prompt?: string;
  target_current_scene?: string;
  scene_summary?: string;
  visual_style?: string;
  reason: string;
  evidence?: string[];
  significance: number;
  confidence: "high";
}

export class GroupBackgroundActionHandler implements HermesActionHandler<ProposeGroupBackgroundImageAction> {
  constructor(
    private readonly logger: Logger,
    private readonly store: GroupBackgroundSuggestionStore,
    private readonly onSuggestionCreated?: (suggestion: GroupBackgroundSuggestion) => void,
    private readonly options: {
      contextProvider?: (notification: KindroidChatNotification) => Promise<GroupBackgroundContext>;
    } = {}
  ) {}

  promptLines(): string[] {
    return [
      'For reviewed group chat background image prompts, you may request: {"type":"propose_group_background_image","group_id":"<same group_id>","title":"<short visual proposal title>","target_current_scene":"<brief current setting if known>","scene_summary":"<visual scene summary>","visual_style":"<style guidance>","prompt":"<image generation prompt for a chat background, no text, no UI, no named real people>","negative_prompt":"<optional exclusions>","reason":"<why the setting changed enough to justify a new background>","evidence":["<specific scene-change evidence>"],"significance":0.82,"confidence":"high"}.',
      "Only propose group background prompts when groupBackgroundContext.enabledForSource is true.",
      "Use this only for a substantial visual scene change: new location, new time/weather, a major setting transition, or a fresh chapter beat. Do not propose for routine replies, emotional tone alone, dice rolls, minor movement, or small talk.",
      "Respect groupBackgroundContext.minSignificance. Return no background proposal below that threshold.",
      "For group chats, use participant names only as broad character-context; the background should depict the place or ambience, not portraits of the Kins.",
      "Background prompts must be safe as chat wallpaper: no text, no logos, no UI elements, no private identifiers, no explicit gore, and avoid foreground faces unless the user later asks for character art.",
      "Kinagent may either store this as a reviewed desktop prompt or, when groupBackgroundContext.mutation is autonomous-generate-apply, generate and apply the background without further review. Keep the proposal threshold high."
    ];
  }

  normalizeActions(decision: HermesActionDecision): ProposeGroupBackgroundImageAction[] {
    if (!Array.isArray(decision.actions)) {
      return [];
    }

    return decision.actions.flatMap((action): ProposeGroupBackgroundImageAction[] => {
      if (!action || typeof action !== "object") {
        return [];
      }

      const record = action as Record<string, unknown>;
      if (
        record.type !== "propose_group_background_image" ||
        record.confidence !== "high" ||
        typeof record.title !== "string" ||
        typeof record.prompt !== "string" ||
        typeof record.reason !== "string" ||
        typeof record.significance !== "number" ||
        !Number.isFinite(record.significance)
      ) {
        return [];
      }

      return [
        {
          type: "propose_group_background_image",
          group_id: typeof record.group_id === "string" ? record.group_id : undefined,
          title: record.title,
          prompt: record.prompt,
          negative_prompt: typeof record.negative_prompt === "string" ? record.negative_prompt : undefined,
          target_current_scene:
            typeof record.target_current_scene === "string" ? record.target_current_scene : undefined,
          scene_summary: typeof record.scene_summary === "string" ? record.scene_summary : undefined,
          visual_style: typeof record.visual_style === "string" ? record.visual_style : undefined,
          reason: record.reason,
          evidence: stringArray(record.evidence),
          significance: Math.max(0, Math.min(1, record.significance)),
          confidence: "high"
        }
      ];
    });
  }

  async handle(notification: KindroidChatNotification, action: ProposeGroupBackgroundImageAction): Promise<void> {
    if (notification.type !== "kindroid.group_chat.changed") {
      this.logger.info("Ignoring group background suggestion for non-group chat.", {
        documentId: notification.documentId,
        type: notification.type
      });
      return;
    }

    const targetGroupId = action.group_id ?? notification.groupId;
    if (targetGroupId !== notification.groupId) {
      this.logger.warn("Ignoring group background suggestion for mismatched group_id.", {
        expectedGroupId: notification.groupId,
        requestedGroupId: targetGroupId
      });
      return;
    }

    const context = await this.options.contextProvider?.(notification);
    if (context && !context.enabledForSource) {
      this.logger.debug("Ignoring group background suggestion because it is disabled for this source.", {
        groupId: notification.groupId,
        documentId: notification.documentId
      });
      return;
    }

    if (context && action.significance < context.minSignificance) {
      this.logger.info("Ignoring group background suggestion below significance threshold.", {
        groupId: notification.groupId,
        documentId: notification.documentId,
        significance: action.significance,
        minSignificance: context.minSignificance
      });
      return;
    }

    const forceProposal =
      notification.type === "kindroid.group_chat.changed" &&
      notification.source === "group-background-prewarm" &&
      notification.forceBackgroundProposal;
    const suggestion = this.store.createPending(
      notification,
      {
        title: action.title,
        prompt: action.prompt,
        negativePrompt: action.negative_prompt,
        targetCurrentScene: action.target_current_scene,
        sceneSummary: action.scene_summary,
        visualStyle: action.visual_style,
        reason: action.reason,
        evidence: action.evidence ?? [],
        significance: action.significance
      },
      {
        bypassPacing: forceProposal,
        replacePendingForGroup: forceProposal
      }
    );

    if (!suggestion) {
      this.logger.info("Group background suggestion skipped.", {
        groupId: notification.groupId,
        documentId: notification.documentId,
        significance: action.significance
      });
      return;
    }

    this.logger.info("Group background suggestion created.", {
      groupId: suggestion.groupId,
      documentId: suggestion.sourceDocumentId,
      significance: suggestion.significance
    });
    this.onSuggestionCreated?.(suggestion);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
