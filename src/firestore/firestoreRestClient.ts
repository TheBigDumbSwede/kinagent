import type { AppConfig } from "../config/types.js";
import { extractFirebaseAppCheckState, loadBrowserSession, loadFreshFirebaseAuth } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import type { FirestoreDocumentLike } from "./types.js";

export interface FirestoreRestDocument {
  name: string;
  fields?: Record<string, FirestoreRestValue>;
  createTime?: string;
  updateTime?: string;
}

export type FirestoreRestValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { arrayValue: { values?: FirestoreRestValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRestValue> } };

export interface ListChatMessagesOptions {
  kinId: string;
  limit: number;
}

export class FirestoreRestClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async listChatMessages(options: ListChatMessagesOptions): Promise<FirestoreDocumentLike[]> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);
    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const appCheck = extractFirebaseAppCheckState(session.storageState);
    const uid = this.config.kindroid.uid || auth.uid;
    const path = `Users/${uid}/AIs/${options.kinId}/ChatMessages`;
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        this.config.kindroid.firebaseProjectId
      )}/databases/(default)/documents/${path}`
    );
    url.searchParams.set("pageSize", String(options.limit));
    url.searchParams.set("orderBy", "timestamp desc");

    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      accept: "application/json"
    };

    if (appCheck?.token) {
      headers["x-firebase-appcheck"] = appCheck.token;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Firestore read failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const payload = (await response.json()) as { documents?: FirestoreRestDocument[] };
    const documents = payload.documents ?? [];

    this.logger.debug("Firestore chat message page loaded.", {
      uid,
      kinId: options.kinId,
      count: documents.length
    });

    return documents.map((document) => firestoreDocumentLike(document));
  }
}

function firestoreDocumentLike(document: FirestoreRestDocument): FirestoreDocumentLike {
  return {
    id: document.name.split("/").pop() ?? document.name,
    data: () => ({
      ...decodeFields(document.fields ?? {}),
      _firestoreName: document.name,
      _createTime: document.createTime,
      _updateTime: document.updateTime
    })
  };
}

function decodeFields(fields: Record<string, FirestoreRestValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      return [key, decodeValue(value)];
    })
  );
}

function decodeValue(value: FirestoreRestValue): unknown {
  if ("nullValue" in value) {
    return null;
  }

  if ("booleanValue" in value) {
    return value.booleanValue;
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  if ("doubleValue" in value) {
    return value.doubleValue;
  }

  if ("timestampValue" in value) {
    return value.timestampValue;
  }

  if ("stringValue" in value) {
    return value.stringValue;
  }

  if ("bytesValue" in value) {
    return value.bytesValue;
  }

  if ("referenceValue" in value) {
    return value.referenceValue;
  }

  if ("geoPointValue" in value) {
    return value.geoPointValue;
  }

  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }

  if ("mapValue" in value) {
    return decodeFields(value.mapValue.fields ?? {});
  }

  return value;
}
