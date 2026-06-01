import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import type { AppConfig, LogLevel } from "./types.js";

dotenv.config({ quiet: true });

const defaultConfig: AppConfig = {
  kindroid: {
    firebaseProjectId: "kindroid-ai",
    uid: "",
    kins: []
  },
  bridge: {
    dedupeWindowSeconds: 180,
    logLevel: "info",
    sessionDir: "./data/browser-session",
    sqlitePath: "./data/bridge.sqlite"
  },
  hermes: {
    enabled: false,
    baseUrl: "http://localhost:8000",
    agentId: "kindroid-bridge"
  }
};

export interface LoadConfigOptions {
  configPath?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const configPath =
    options.configPath ??
    process.env.KINAGENT_CONFIG ??
    path.resolve(process.cwd(), "config.yaml");

  const fileConfig = readYamlConfig(configPath);
  const merged = mergeConfig(defaultConfig, fileConfig);

  applyEnvOverrides(merged);
  normalizePaths(merged);
  validateConfig(merged);

  return merged;
}

function readYamlConfig(configPath: string): Partial<AppConfig> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as Partial<AppConfig>) : {};
}

function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return {
    kindroid: {
      ...base.kindroid,
      ...override.kindroid,
      kins: override.kindroid?.kins ?? base.kindroid.kins
    },
    bridge: {
      ...base.bridge,
      ...override.bridge
    },
    hermes: {
      ...base.hermes,
      ...override.hermes
    }
  };
}

function applyEnvOverrides(config: AppConfig): void {
  config.kindroid.firebaseProjectId =
    process.env.KINDROID_FIREBASE_PROJECT_ID ?? config.kindroid.firebaseProjectId;
  config.kindroid.uid = process.env.KINDROID_UID ?? config.kindroid.uid;

  config.bridge.dedupeWindowSeconds = numberFromEnv(
    "BRIDGE_DEDUPE_WINDOW_SECONDS",
    config.bridge.dedupeWindowSeconds
  );
  config.bridge.logLevel = logLevelFromEnv("BRIDGE_LOG_LEVEL", config.bridge.logLevel);
  config.bridge.sessionDir = process.env.BRIDGE_SESSION_DIR ?? config.bridge.sessionDir;
  config.bridge.sqlitePath = process.env.BRIDGE_SQLITE_PATH ?? config.bridge.sqlitePath;

  config.hermes.enabled = booleanFromEnv("HERMES_ENABLED", config.hermes.enabled);
  config.hermes.baseUrl = process.env.HERMES_BASE_URL ?? config.hermes.baseUrl;
  config.hermes.agentId = process.env.HERMES_AGENT_ID ?? config.hermes.agentId;
}

function normalizePaths(config: AppConfig): void {
  config.bridge.sessionDir = path.resolve(process.cwd(), config.bridge.sessionDir);
  config.bridge.sqlitePath = path.resolve(process.cwd(), config.bridge.sqlitePath);
}

function validateConfig(config: AppConfig): void {
  if (!config.kindroid.firebaseProjectId) {
    throw new Error("kindroid.firebaseProjectId is required.");
  }

  if (!Number.isFinite(config.bridge.dedupeWindowSeconds) || config.bridge.dedupeWindowSeconds < 1) {
    throw new Error("bridge.dedupeWindowSeconds must be a positive number.");
  }

}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function logLevelFromEnv(name: string, fallback: LogLevel): LogLevel {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  throw new Error(`${name} must be one of debug, info, warn, or error.`);
}
