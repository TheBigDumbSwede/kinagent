import type { KindroidChatNotification } from "../firestore/types.js";

export interface HermesAdapter {
  handleChatChanged(notification: KindroidChatNotification): Promise<void>;
}
