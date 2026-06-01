import fs from "node:fs";
import { assertStorageStateExists } from "./tokenStore.js";

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface BrowserOriginState {
  origin: string;
  localStorage?: Array<{ name: string; value: string }>;
  indexedDB?: BrowserIndexedDb[];
}

export interface BrowserIndexedDb {
  name: string;
  version?: number;
  stores?: BrowserIndexedDbStore[];
}

export interface BrowserIndexedDbStore {
  name: string;
  records?: BrowserIndexedDbRecord[];
}

export interface BrowserIndexedDbRecord {
  key: unknown;
  value: unknown;
  valueEncoded?: unknown;
}

export interface BrowserStorageState {
  cookies?: BrowserCookie[];
  origins?: BrowserOriginState[];
}

export interface FirebaseAuthState {
  apiKey: string;
  appName: string;
  uid?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expirationTime?: number;
}

export interface FreshFirebaseAuthState extends FirebaseAuthState {
  accessToken: string;
  refreshToken: string;
  uid: string;
}

export interface FirebaseAppCheckState {
  token: string;
  expireTimeMillis?: number;
  issuedAtTimeMillis?: number;
}

export interface LoadedBrowserSession {
  storageStatePath: string;
  storageState: BrowserStorageState;
  firebaseAuth: FirebaseAuthState | null;
}

const firebaseAuthKeyPattern = /^firebase:authUser:([^:]+):(.+)$/;

export function loadBrowserSession(sessionDir: string): LoadedBrowserSession {
  const statePath = assertStorageStateExists(sessionDir);
  const storageState = JSON.parse(fs.readFileSync(statePath, "utf8")) as BrowserStorageState;

  return {
    storageStatePath: statePath,
    storageState,
    firebaseAuth: extractFirebaseAuthState(storageState)
  };
}

export function extractFirebaseAuthState(storageState: BrowserStorageState): FirebaseAuthState | null {
  for (const origin of storageState.origins ?? []) {
    const localStorageAuth = extractFirebaseAuthFromLocalStorage(origin);
    if (localStorageAuth) {
      return localStorageAuth;
    }

    const indexedDbAuth = extractFirebaseAuthFromIndexedDb(origin);
    if (indexedDbAuth) {
      return indexedDbAuth;
    }
  }

  return null;
}

export function summarizeSessionAuth(storageState: BrowserStorageState): {
  hasFirebaseAuth: boolean;
  firebaseUid?: string;
  firebaseEmailPresent?: boolean;
  tokenPresent?: boolean;
  refreshTokenPresent?: boolean;
  expirationTime?: number;
  expirationIso?: string;
  indexedDbOrigins: Array<{ origin: string; databaseNames: string[] }>;
  appCheckTokenPresent: boolean;
  appCheckExpirationIso?: string;
} {
  const firebaseAuth = extractFirebaseAuthState(storageState);
  const appCheck = extractFirebaseAppCheckState(storageState);
  return {
    hasFirebaseAuth: Boolean(firebaseAuth),
    firebaseUid: firebaseAuth?.uid,
    firebaseEmailPresent: firebaseAuth ? Boolean(firebaseAuth.email) : undefined,
    tokenPresent: firebaseAuth ? Boolean(firebaseAuth.accessToken) : undefined,
    refreshTokenPresent: firebaseAuth ? Boolean(firebaseAuth.refreshToken) : undefined,
    expirationTime: firebaseAuth?.expirationTime,
    expirationIso: firebaseAuth?.expirationTime ? new Date(firebaseAuth.expirationTime).toISOString() : undefined,
    indexedDbOrigins: (storageState.origins ?? [])
      .filter((origin) => (origin.indexedDB ?? []).length > 0)
      .map((origin) => ({
        origin: origin.origin,
        databaseNames: (origin.indexedDB ?? []).map((database) => database.name)
      })),
    appCheckTokenPresent: Boolean(appCheck?.token),
    appCheckExpirationIso: appCheck?.expireTimeMillis ? new Date(appCheck.expireTimeMillis).toISOString() : undefined
  };
}

export function extractFirebaseAppCheckState(storageState: BrowserStorageState): FirebaseAppCheckState | null {
  for (const origin of storageState.origins ?? []) {
    for (const database of origin.indexedDB ?? []) {
      if (database.name !== "firebase-app-check-database") {
        continue;
      }

      for (const store of database.stores ?? []) {
        for (const record of store.records ?? []) {
          const decodedValue = decodePlaywrightIndexedDbValue(record.valueEncoded) ?? record.value;
          const appCheckRecord = normalizeRecordValue(decodedValue);
          const appCheckValue = normalizeRecordValue(appCheckRecord?.value);
          const token = stringValue(appCheckValue?.token);
          if (!token) {
            continue;
          }

          return {
            token,
            expireTimeMillis: numberValue(appCheckValue?.expireTimeMillis),
            issuedAtTimeMillis: numberValue(appCheckValue?.issuedAtTimeMillis)
          };
        }
      }
    }
  }

  return null;
}

export async function loadFreshFirebaseAuth(sessionDir: string): Promise<FreshFirebaseAuthState> {
  const session = loadBrowserSession(sessionDir);
  const firebaseAuth = session.firebaseAuth;
  if (!firebaseAuth?.uid || !firebaseAuth.accessToken || !firebaseAuth.refreshToken) {
    throw new Error(
      "Saved session does not contain complete Firebase auth state. Run npm run login after the Kindroid app is fully loaded."
    );
  }

  if (!firebaseAuth.expirationTime || firebaseAuth.expirationTime > Date.now() + 60_000) {
    return firebaseAuth as FreshFirebaseAuthState;
  }

  return refreshFirebaseAuth(firebaseAuth as FreshFirebaseAuthState);
}

async function refreshFirebaseAuth(auth: FreshFirebaseAuthState): Promise<FreshFirebaseAuthState> {
  if (!auth.apiKey) {
    throw new Error("Firebase API key is missing from saved auth state; cannot refresh expired token.");
  }

  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(auth.apiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Firebase token refresh failed with HTTP ${response.status}. Run npm run login again.`);
  }

  const payload = (await response.json()) as {
    id_token?: string;
    refresh_token?: string;
    expires_in?: string;
    user_id?: string;
  };

  if (!payload.id_token || !payload.refresh_token) {
    throw new Error("Firebase token refresh response did not include the expected token fields.");
  }

  const expiresInMs = Number(payload.expires_in ?? "3600") * 1000;

  return {
    ...auth,
    uid: payload.user_id ?? auth.uid,
    accessToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expirationTime: Date.now() + expiresInMs
  };
}

function extractFirebaseAuthFromLocalStorage(origin: BrowserOriginState): FirebaseAuthState | null {
  for (const item of origin.localStorage ?? []) {
    const keyParts = parseFirebaseAuthKey(item.name);
    if (!keyParts) {
      continue;
    }

    const parsed = parseJsonObject(item.value);
    if (!parsed) {
      continue;
    }

    return firebaseAuthFromRecord(keyParts.apiKey, keyParts.appName, parsed);
  }

  return null;
}

function extractFirebaseAuthFromIndexedDb(origin: BrowserOriginState): FirebaseAuthState | null {
  for (const database of origin.indexedDB ?? []) {
    for (const store of database.stores ?? []) {
      for (const record of store.records ?? []) {
        const key = typeof record.key === "string" ? record.key : null;
        const decodedValue = decodePlaywrightIndexedDbValue(record.valueEncoded) ?? record.value;
        const value = normalizeRecordValue(decodedValue);

        const authFromFirebaseLocalStorage = authFromFirebaseLocalStorageRecord(key, value);
        if (authFromFirebaseLocalStorage) {
          return authFromFirebaseLocalStorage;
        }

        const keyParts = key ? parseFirebaseAuthKey(key) : null;
        if (keyParts && value) {
          return firebaseAuthFromRecord(keyParts.apiKey, keyParts.appName, value);
        }
      }
    }
  }

  return null;
}

function authFromFirebaseLocalStorageRecord(
  key: string | null,
  record: Record<string, unknown> | null
): FirebaseAuthState | null {
  if (!record) {
    return null;
  }

  const fbaseKey = stringValue(record.fbase_key) ?? key;
  const value = normalizeRecordValue(record.value);
  const keyParts = fbaseKey ? parseFirebaseAuthKey(fbaseKey) : null;

  if (!keyParts || !value) {
    return null;
  }

  return firebaseAuthFromRecord(keyParts.apiKey, keyParts.appName, value);
}

function parseFirebaseAuthKey(key: string): { apiKey: string; appName: string } | null {
  const match = firebaseAuthKeyPattern.exec(key);
  if (!match) {
    return null;
  }

  return {
    apiKey: match[1] ?? "",
    appName: match[2] ?? "[DEFAULT]"
  };
}

function firebaseAuthFromRecord(apiKey: string, appName: string, record: Record<string, unknown>): FirebaseAuthState {
  const tokenManager = isRecord(record.stsTokenManager) ? record.stsTokenManager : {};

  return {
    apiKey,
    appName,
    uid: stringValue(record.uid),
    email: stringValue(record.email),
    accessToken: stringValue(tokenManager.accessToken),
    refreshToken: stringValue(tokenManager.refreshToken),
    expirationTime: numberValue(tokenManager.expirationTime)
  };
}

function normalizeRecordValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return parseJsonObject(value);
  }

  return isRecord(value) ? value : null;
}

function decodePlaywrightIndexedDbValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return null;
  }

  return decodePlaywrightSerializedValue(value, new Map<number, unknown>());
}

function decodePlaywrightSerializedValue(value: unknown, seen: Map<number, unknown>): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const id = numberValue(value.id);
  if (id !== undefined && seen.has(id)) {
    return seen.get(id);
  }

  if (Array.isArray(value.a)) {
    const decodedArray: unknown[] = [];
    if (id !== undefined) {
      seen.set(id, decodedArray);
    }

    for (const item of value.a) {
      decodedArray.push(decodePlaywrightSerializedValue(item, seen));
    }

    return decodedArray;
  }

  if (Array.isArray(value.o)) {
    const decodedObject: Record<string, unknown> = {};
    if (id !== undefined) {
      seen.set(id, decodedObject);
    }

    for (const property of value.o) {
      if (!isRecord(property) || typeof property.k !== "string") {
        continue;
      }

      decodedObject[property.k] = decodePlaywrightSerializedValue(property.v, seen);
    }

    return decodedObject;
  }

  if ("v" in value) {
    return value.v;
  }

  return value;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function buildCookieHeader(storageState: BrowserStorageState, targetHost: string): string | null {
  const nowSeconds = Date.now() / 1000;
  const cookies = (storageState.cookies ?? []).filter((cookie) => {
    const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
    const domainMatches = targetHost === domain || targetHost.endsWith(`.${domain}`);
    const notExpired = !cookie.expires || cookie.expires < 0 || cookie.expires > nowSeconds;
    return domainMatches && notExpired;
  });

  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function firestoreAuthReuseError(projectId: string): Error {
  return new Error(
    [
      `Firestore listener is not connected yet for Firebase project "${projectId}".`,
      "The saved browser session was found, but this prototype does not yet safely attach Kindroid's browser Firebase auth state to the Node Firebase client.",
      "Next implementation step: create a Firebase auth handoff that rehydrates the extracted firebase:authUser entry without printing or manually pasting tokens, then attach it before subscribing to Users/{uid}/AIs/{ai_id}/ChatMessages."
    ].join(" ")
  );
}
