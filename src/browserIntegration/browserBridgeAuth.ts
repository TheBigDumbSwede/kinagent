import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const BROWSER_BRIDGE_AUTH_FILE_NAME = "browser-bridge-auth.json";

export interface BrowserBridgeAuthFile {
  version: 1;
  secret: string;
  createdAt: string;
}

export function browserBridgeAuthPath(userDataDir: string): string {
  return path.join(userDataDir, BROWSER_BRIDGE_AUTH_FILE_NAME);
}

export function loadOrCreateBrowserBridgeAuth(authPath: string): BrowserBridgeAuthFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as unknown;
    if (isBrowserBridgeAuthFile(parsed)) {
      return parsed;
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const auth: BrowserBridgeAuthFile = {
    version: 1,
    secret: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const tmpPath = `${authPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, authPath);
  try {
    fs.chmodSync(authPath, 0o600);
  } catch {
    // Best effort: Windows ACLs are applied through the per-user app data path.
  }

  return auth;
}

function isBrowserBridgeAuthFile(value: unknown): value is BrowserBridgeAuthFile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.secret === "string" && record.secret.length >= 32;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
