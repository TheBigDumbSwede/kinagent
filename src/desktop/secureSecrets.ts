import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { saveConfig } from "../config/loadConfig.js";
import type { AppConfig } from "../config/types.js";

export interface SecureSecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface SecureSecretEntry {
  encrypted: string;
  updatedAt: string;
}

interface SecureSecretFile {
  version: 1;
  entries: Record<string, SecureSecretEntry>;
}

interface SecretField {
  key: string;
  get(config: AppConfig): string;
  set(config: AppConfig, value: string): void;
}

const secretFields: SecretField[] = [
  {
    key: "kindroid.apiKey",
    get: (config) => config.kindroid.apiKey ?? "",
    set: (config, value) => {
      config.kindroid.apiKey = value;
    }
  },
  {
    key: "hermes.apiKey",
    get: (config) => config.hermes.apiKey,
    set: (config, value) => {
      config.hermes.apiKey = value;
    }
  },
  {
    key: "hermes.groupBackgrounds.images.openai.apiKey",
    get: (config) => config.hermes.groupBackgrounds.images.openai.apiKey,
    set: (config, value) => {
      config.hermes.groupBackgrounds.images.openai.apiKey = value;
    }
  },
  {
    key: "voice.openai.apiKey",
    get: (config) => config.voice.openai.apiKey,
    set: (config, value) => {
      config.voice.openai.apiKey = value;
    }
  },
  {
    key: "voice.elevenlabs.apiKey",
    get: (config) => config.voice.elevenlabs.apiKey,
    set: (config, value) => {
      config.voice.elevenlabs.apiKey = value;
    }
  }
];

export class SecureSecretStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: SecureSecretCipher = safeStorage
  ) {}

  available(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  set(key: string, value: string): void {
    if (!this.available()) {
      return;
    }

    const file = this.read();
    file.entries[key] = {
      encrypted: this.cipher.encryptString(value).toString("base64"),
      updatedAt: new Date().toISOString()
    };
    this.write(file);
  }

  delete(key: string): void {
    if (!this.available()) {
      return;
    }

    const file = this.read();
    if (!(key in file.entries)) {
      return;
    }
    delete file.entries[key];
    this.write(file);
  }

  get(key: string): string | null {
    if (!this.available()) {
      return null;
    }

    const entry = this.read().entries[key];
    if (!entry) {
      return null;
    }

    try {
      return this.cipher.decryptString(Buffer.from(entry.encrypted, "base64"));
    } catch {
      return null;
    }
  }

  status(): { available: boolean; path: string; storedKeys: string[] } {
    return {
      available: this.available(),
      path: this.filePath,
      storedKeys: this.available() ? Object.keys(this.read().entries).sort() : []
    };
  }

  private read(): SecureSecretFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SecureSecretFile;
      if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        return parsed;
      }
    } catch {
      // Missing or corrupt secure-secret files are treated as empty.
    }
    return { version: 1, entries: {} };
  }

  private write(file: SecureSecretFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }
}

export function secureSecretsPath(userDataDir: string): string {
  return path.join(userDataDir, "secure-secrets.json");
}

export function applyStoredConfigSecrets(config: AppConfig, store: SecureSecretStore): AppConfig {
  if (!store.available()) {
    return config;
  }

  const next = cloneConfig(config);
  for (const field of secretFields) {
    const value = store.get(field.key);
    if (value !== null) {
      field.set(next, value);
    }
  }
  return next;
}

export function saveConfigSecrets(config: AppConfig, store: SecureSecretStore): boolean {
  if (!store.available()) {
    return false;
  }

  for (const field of secretFields) {
    const value = field.get(config).trim();
    if (value) {
      store.set(field.key, value);
    } else {
      store.delete(field.key);
    }
  }
  return true;
}

export function migrateConfigSecretsToSecureStore(
  config: AppConfig,
  configPath: string,
  store: SecureSecretStore
): AppConfig {
  if (!store.available()) {
    return config;
  }

  const plaintextSecrets = secretFields
    .map((field) => ({ field, value: field.get(config).trim() }))
    .filter((entry) => entry.value);
  if (plaintextSecrets.length === 0) {
    return applyStoredConfigSecrets(config, store);
  }

  for (const { field, value } of plaintextSecrets) {
    store.set(field.key, value);
  }
  const scrubbed = scrubConfigSecrets(config);
  saveConfig(scrubbed, configPath);
  return applyStoredConfigSecrets(scrubbed, store);
}

export function scrubConfigSecrets(config: AppConfig): AppConfig {
  const next = cloneConfig(config);
  for (const field of secretFields) {
    field.set(next, "");
  }
  return next;
}

function cloneConfig(value: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(value)) as AppConfig;
}
