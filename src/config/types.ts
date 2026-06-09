export type LogLevel = "debug" | "info" | "warn" | "error";

export interface KinConfig {
  name: string;
  aiId: string;
  enabled: boolean;
}

export interface KindroidConfig {
  apiKey?: string;
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
  journalSuggestions: {
    enabled: boolean;
    throttleMessages: number;
    strongEventBypass: boolean;
  };
  groupBackgrounds: {
    suggestions: {
      enabled: boolean;
      autonomous: boolean;
      minMessagesBetweenProposals: number;
      minSignificance: number;
    };
    images: {
      enabled: boolean;
      provider: "openai";
      openai: {
        apiKey: string;
        model: string;
        size: string;
        quality: string;
      };
    };
  };
  chatDynamism: {
    suggestions: {
      enabled: boolean;
    };
    autoAdjust: {
      enabled: boolean;
      minTurnsBetweenAdjustments: number;
      min: number;
      max: number;
      maxDelta: number;
    };
  };
}

export type VoiceProvider = "none" | "openai" | "elevenlabs";

export interface VoiceConfig {
  enabled: boolean;
  provider: VoiceProvider;
  openai: {
    apiKey: string;
    model: string;
    voice: string;
    instructions: string;
  };
  elevenlabs: {
    apiKey: string;
    model: string;
    outputFormat: string;
  };
}

export interface AppConfig {
  kindroid: KindroidConfig;
  bridge: BridgeConfig;
  hermes: HermesConfig;
  voice: VoiceConfig;
}
