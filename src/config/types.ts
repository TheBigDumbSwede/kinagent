export type LogLevel = "debug" | "info" | "warn" | "error";

export interface KinConfig {
  name: string;
  aiId: string;
  enabled: boolean;
}

export interface KindroidConfig {
  firebaseProjectId: string;
  uid: string;
  kins: KinConfig[];
}

export interface BridgeConfig {
  dedupeWindowSeconds: number;
  logPath: string;
  logLevel: LogLevel;
  sessionDir: string;
  sqlitePath: string;
}

export interface HermesConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  agentId: string;
  currentSceneUpdates: {
    enabled: boolean;
    maxLength: number;
  };
}

export interface AppConfig {
  kindroid: KindroidConfig;
  bridge: BridgeConfig;
  hermes: HermesConfig;
}
