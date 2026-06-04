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

export interface ListDocumentsOptions {
  collectionPath: string;
  pageSize?: number;
  maxDocuments?: number;
  orderBy?: string;
  logLabel?: string;
}

export class FirestoreRestClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async resolveUid(): Promise<string> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);
    return this.config.kindroid.uid || auth.uid;
  }

  async listDocuments(options: ListDocumentsOptions): Promise<FirestoreDocumentLike[]> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);
    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const appCheck = extractFirebaseAppCheckState(session.storageState);
    const documents: FirestoreRestDocument[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          this.config.kindroid.firebaseProjectId
        )}/databases/(default)/documents/${encodeFirestorePath(options.collectionPath)}`
      );
      url.searchParams.set("pageSize", String(options.pageSize ?? 100));
      if (options.orderBy) {
        url.searchParams.set("orderBy", options.orderBy);
      }
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url, { headers: this.authHeaders(auth.accessToken, appCheck?.token) });
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Firestore read failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
      }

      const payload = (await response.json()) as {
        documents?: FirestoreRestDocument[];
        nextPageToken?: string;
      };
      documents.push(...(payload.documents ?? []));
      if (options.maxDocuments && documents.length >= options.maxDocuments) {
        break;
      }
      pageToken = payload.nextPageToken;
    } while (pageToken);

    this.logger.debug("Firestore document page loaded.", {
      collectionPath: options.collectionPath,
      logLabel: options.logLabel,
      count: documents.length
    });

    return documents.slice(0, options.maxDocuments).map((document) => firestoreDocumentLike(document));
  }

  async getDocument(documentPath: string): Promise<FirestoreDocumentLike | null> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir);
    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const appCheck = extractFirebaseAppCheckState(session.storageState);
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        this.config.kindroid.firebaseProjectId
      )}/databases/(default)/documents/${encodeFirestorePath(documentPath)}`
    );

    const response = await fetch(url, { headers: this.authHeaders(auth.accessToken, appCheck?.token) });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Firestore document read failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    return firestoreDocumentLike((await response.json()) as FirestoreRestDocument);
  }

  private authHeaders(firebaseAuthJwt: string, appCheckToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${firebaseAuthJwt}`,
      accept: "application/json"
    };

    if (appCheckToken) {
      headers["x-firebase-appcheck"] = appCheckToken;
    }

    return headers;
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

function encodeFirestorePath(path: string): string {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
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
