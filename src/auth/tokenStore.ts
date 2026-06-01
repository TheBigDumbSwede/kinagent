import fs from "node:fs";
import path from "node:path";

export const storageStateFileName = "storage-state.json";

export function storageStatePath(sessionDir: string): string {
  return path.join(sessionDir, storageStateFileName);
}

export function ensureSessionDir(sessionDir: string): void {
  fs.mkdirSync(sessionDir, { recursive: true });
}

export function assertStorageStateExists(sessionDir: string): string {
  const statePath = storageStatePath(sessionDir);
  if (!fs.existsSync(statePath)) {
    throw new Error(
      `No Kindroid browser session found at ${statePath}. Run "npm run login" first.`
    );
  }

  return statePath;
}
