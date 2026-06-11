import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type { BrowserSessionStorage } from "../auth/browserSessionStorage.js";
import { atomicWriteFile } from "../auth/browserSessionStorage.js";
import type { BrowserStorageState } from "../auth/firebaseSession.js";
import { ensureSessionDir, storageStatePath } from "../auth/tokenStore.js";

export const encryptedStorageStateFileName = "storage-state.json.enc";

export function encryptedStorageStatePath(sessionDir: string): string {
  return path.join(sessionDir, encryptedStorageStateFileName);
}

export class EncryptedBrowserSessionStorage implements BrowserSessionStorage {
  storageStatePath(sessionDir: string): string {
    return this.existsEncrypted(sessionDir) ? encryptedStorageStatePath(sessionDir) : storageStatePath(sessionDir);
  }

  exists(sessionDir: string): boolean {
    return this.existsEncrypted(sessionDir) || fs.existsSync(storageStatePath(sessionDir));
  }

  load(sessionDir: string): BrowserStorageState {
    const encryptedPath = encryptedStorageStatePath(sessionDir);
    if (fs.existsSync(encryptedPath)) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Saved Kindroid browser session is encrypted, but OS secure storage is unavailable.");
      }

      const decrypted = safeStorage.decryptString(fs.readFileSync(encryptedPath));
      return JSON.parse(decrypted) as BrowserStorageState;
    }

    const plaintextPath = storageStatePath(sessionDir);
    if (!fs.existsSync(plaintextPath)) {
      throw new Error(`No Kindroid browser session found at ${plaintextPath}. Use Open Login, then Save Session.`);
    }

    return JSON.parse(fs.readFileSync(plaintextPath, "utf8")) as BrowserStorageState;
  }

  save(sessionDir: string, storageState: BrowserStorageState): void {
    ensureSessionDir(sessionDir);
    const serialized = `${JSON.stringify(storageState, null, 2)}\n`;
    if (!safeStorage.isEncryptionAvailable()) {
      atomicWriteFile(storageStatePath(sessionDir), serialized);
      return;
    }

    atomicWriteFile(encryptedStorageStatePath(sessionDir), safeStorage.encryptString(serialized));
    fs.rmSync(storageStatePath(sessionDir), { force: true });
  }

  migrate(sessionDir: string): boolean {
    if (!safeStorage.isEncryptionAvailable() || this.existsEncrypted(sessionDir)) {
      return false;
    }

    const plaintextPath = storageStatePath(sessionDir);
    if (!fs.existsSync(plaintextPath)) {
      return false;
    }

    this.save(sessionDir, JSON.parse(fs.readFileSync(plaintextPath, "utf8")) as BrowserStorageState);
    return true;
  }

  encrypted(sessionDir: string): boolean {
    return this.existsEncrypted(sessionDir);
  }

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private existsEncrypted(sessionDir: string): boolean {
    return fs.existsSync(encryptedStorageStatePath(sessionDir));
  }
}
