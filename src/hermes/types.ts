import type { KindroidChatNotification } from "../firestore/types.js";

export type HermesSoundscapePrewarmRequest =
  | {
      scope: "kin";
      kinId: string;
      documentId: string;
      timestamp: string;
      text: string;
      soundscapeContext: unknown;
    }
  | {
      scope: "group";
      groupId: string;
      aiId?: string | null;
      documentId: string;
      timestamp: string;
      text: string;
      soundscapeContext: unknown;
    };

export type HermesLocalScenePrewarmRequest =
  | {
      scope: "kin";
      kinId: string;
      documentId: string;
      timestamp: string;
      text: string;
      localSceneContext: unknown;
    }
  | {
      scope: "group";
      groupId: string;
      aiId?: string | null;
      documentId: string;
      timestamp: string;
      text: string;
      localSceneContext: unknown;
    };

export type HermesPreviouslyOnPrewarmRequest =
  | {
      scope: "kin";
      kinId: string;
      documentId: string;
      timestamp: string;
      text: string;
      previouslyOnContext: unknown;
    }
  | {
      scope: "group";
      groupId: string;
      aiId?: string | null;
      documentId: string;
      timestamp: string;
      text: string;
      previouslyOnContext: unknown;
    };

export interface HermesAdapter {
  handleChatChanged(notification: KindroidChatNotification): Promise<void>;
  prewarmSoundscape?(request: HermesSoundscapePrewarmRequest): Promise<void>;
  prewarmLocalScene?(request: HermesLocalScenePrewarmRequest): Promise<void>;
  prewarmPreviouslyOn?(request: HermesPreviouslyOnPrewarmRequest): Promise<void>;
}
