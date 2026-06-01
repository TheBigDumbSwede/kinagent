export interface NormalizedKindroidMessage {
  id: string;
  kinId: string;
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
  sender: string | null;
  role: string | null;
  source: "firestore";
}

export interface FirestoreDocumentLike {
  id: string;
  data(): unknown;
}
