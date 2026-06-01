import type { KindroidChatChangeNotification } from "../firestore/types.js";

export interface HermesAdapter {
  handleChatChanged(notification: KindroidChatChangeNotification): Promise<void>;
}
