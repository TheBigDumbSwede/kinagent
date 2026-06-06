export interface NormalizedKindroidMessage {
  id: string;
  kinId: string;
  groupId?: string;
  timestamp: string | null;
  text: string | null;
  textEncrypted?: boolean;
  textDecrypted?: boolean;
  textDecryptionError?: string;
  sender: string | null;
  role: string | null;
  raw: unknown;
}

export interface KindroidChatChangeNotification {
  type: "kindroid.chat.changed";
  kinId: string;
  documentId: string;
  timestamp: string | null;
  text?: string | null;
  textEncrypted?: boolean;
  textDecrypted?: boolean;
  textDecryptionError?: string;
  sender: string | null;
  role: string | null;
  source: "firestore" | "soundscape-prewarm" | "local-scene-prewarm";
}

export interface KindroidGroupChatChangeNotification {
  type: "kindroid.group_chat.changed";
  groupId: string;
  aiId: string | null;
  documentId: string;
  timestamp: string | null;
  text?: string | null;
  textEncrypted?: boolean;
  textDecrypted?: boolean;
  textDecryptionError?: string;
  sender: string | null;
  role: string | null;
  source: "firestore" | "soundscape-prewarm" | "local-scene-prewarm";
}

export type KindroidChatNotification = KindroidChatChangeNotification | KindroidGroupChatChangeNotification;

export interface FirestoreDocumentLike {
  id: string;
  data(): unknown;
}

export interface FirestoreDeletedDocumentLike {
  id: string;
  name: string;
  readTime?: string;
}
