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

export interface HermesAdapter {
  handleChatChanged(notification: KindroidChatNotification): Promise<void>;
  prewarmSoundscape?(request: HermesSoundscapePrewarmRequest): Promise<void>;
}
