import fs from "node:fs";
import path from "node:path";
import type { BrowserStorageState } from "./firebaseSession.js";
import { ensureSessionDir, storageStatePath } from "./tokenStore.js";

export interface BrowserSessionStorage {
  storageStatePath(sessionDir: string): string;
  exists(sessionDir: string): boolean;
  load(sessionDir: string): BrowserStorageState;
  save(sessionDir: string, storageState: BrowserStorageState): void;
}

class PlaintextBrowserSessionStorage implements BrowserSessionStorage {
  storageStatePath(sessionDir: string): string {
    return storageStatePath(sessionDir);
  }

  exists(sessionDir: string): boolean {
    return fs.existsSync(this.storageStatePath(sessionDir));
  }

  load(sessionDir: string): BrowserStorageState {
    const statePath = this.assertExists(sessionDir);
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as BrowserStorageState;
  }

  save(sessionDir: string, storageState: BrowserStorageState): void {
    ensureSessionDir(sessionDir);
    fs.writeFileSync(this.storageStatePath(sessionDir), `${JSON.stringify(storageState, null, 2)}\n`, "utf8");
  }

  private assertExists(sessionDir: string): string {
    const statePath = this.storageStatePath(sessionDir);
    if (!fs.existsSync(statePath)) {
      const encryptedStatePath = path.join(sessionDir, "storage-state.json.enc");
      if (fs.existsSync(encryptedStatePath)) {
        throw new Error(
          `No CLI-readable Kindroid browser session found at ${statePath}. ` +
            `A desktop-encrypted session exists at ${encryptedStatePath}, but headless CLI commands cannot decrypt Electron safeStorage files. ` +
            `Run "npm run login" to create a plaintext CLI session, or use the desktop app.`
        );
      }
      throw new Error(`No Kindroid browser session found at ${statePath}. Run "npm run login" first.`);
    }

    return statePath;
  }
}

let browserSessionStorage: BrowserSessionStorage = new PlaintextBrowserSessionStorage();

export function currentBrowserSessionStorage(): BrowserSessionStorage {
  return browserSessionStorage;
}

export function setBrowserSessionStorageForProcess(storage: BrowserSessionStorage): void {
  browserSessionStorage = storage;
}

export function atomicWriteFile(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}
