export interface KinAnalysisResult {
  jobId?: string;
  reportMarkdown?: string;
  findingCount?: number;
}

export interface KinAnalysisProgress {
  jobId?: string;
  phase?: string;
  message?: string;
}

export interface ChatExportRequest {
  fromDate?: string;
  toDate?: string;
}

export interface ChatExportResult {
  ok?: boolean;
  canceled?: boolean;
  filePath?: string;
  exportedCount?: number;
  totalCount?: number;
  jobId?: string;
}

export interface ChatExportProgress {
  jobId?: string;
  phase?: string;
  processed?: number;
  total?: number;
  message?: string;
}

export interface KinagentApi {
  analyzeKin(input: { kinId: string }): Promise<KinAnalysisResult>;
  exportKinChat(input: ChatExportRequest & { kinId: string }): Promise<ChatExportResult>;
  exportGroupChat(input: ChatExportRequest & { groupId: string }): Promise<ChatExportResult>;
  saveSettings(input: AppSettingsFormValue): Promise<AppSettingsResult>;
  setKinVoicePreference(input: { kinId: string; preference: KinVoicePreference }): Promise<KinVoicePreferenceResult>;
  setKinAmbientPreference(input: {
    kinId: string;
    enabled: boolean;
    chatDynamism: KinChatDynamismPreference;
  }): Promise<KinAmbientPreferenceResult>;
}

export interface PanelState {
  selectedKinId: string | null;
  selectedGroupId: string | null;
  kinAnalysisRunning: boolean;
  kinAnalysisJobId: string | null;
  kinAnalysisReport: string;
  chatExportSaving: boolean;
  chatExportJobId: string | null;
}

export interface AnalysisPanelElements {
  kinAnalyzeProgress: HTMLProgressElement;
  kinAnalyzeStatusLine: HTMLElement;
  kinAnalyzeReport: HTMLElement;
}

export interface ChatExportPanelElements {
  chatExportFromInput: HTMLInputElement;
  chatExportToInput: HTMLInputElement;
  chatExportProgress: HTMLProgressElement;
  chatExportStatusLine: HTMLElement;
}

export interface PanelContext<TElements> {
  state: PanelState;
  elements: TElements;
  api: KinagentApi;
  renderActivity: () => void;
}

export interface KinSummary {
  aiId?: string | null;
  name?: string | null;
}

export interface SubscriptionSummary {
  kin?: KinSummary;
  ambientContextEnabled?: boolean;
  chatDynamism?: unknown;
}

export interface ChatDynamismValue {
  display?: string | null;
  numeric?: number | null;
}

export interface KinChatDynamismPreference {
  enabled: boolean;
  min: number;
  max: number;
}

export interface KinAmbientPreferenceResult {
  ok?: boolean;
  enabled?: boolean;
  chatDynamism?: KinChatDynamismPreference;
  currentChatDynamism?: ChatDynamismValue | null;
}

export interface KinVoicePreference {
  enabled?: boolean;
  provider?: string;
  openaiVoice?: string;
  openaiInstructions?: string;
  elevenLabsVoiceId?: string;
  filterNarrationForTts?: boolean;
  narrationDelimiter?: string;
}

export interface KinVoicePreferenceResult {
  ok?: boolean;
  globalEnabled?: boolean;
  configuredProviders?: Record<string, boolean>;
  openAiVoiceOptions?: string[];
  preference?: KinVoicePreference;
}

export interface AppSettingsFormValue {
  logLevel: string;
  dedupeWindowSeconds: number;
  hermesEnabled: boolean;
  hermesBaseUrl: string;
  hermesAgentId: string;
  hermesApiKey: string;
  hermesCurrentSceneEnabled: boolean;
  hermesCurrentSceneMaxLength: number;
  hermesJournalSuggestionsEnabled: boolean;
  hermesJournalStrongEventBypass: boolean;
  hermesJournalThrottleMessages: number;
  voiceEnabled: boolean;
  voiceProvider: string;
  openAiApiKey: string;
  openAiModel: string;
  openAiVoice: string;
  openAiInstructions: string;
  elevenLabsApiKey: string;
  elevenLabsModel: string;
  elevenLabsOutputFormat: string;
}

export interface AppConfigView {
  bridge?: {
    logLevel?: string;
    dedupeWindowSeconds?: number;
  };
  hermes?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    agentId?: string;
    currentSceneUpdates?: {
      enabled?: boolean;
      maxLength?: number;
    };
    journalSuggestions?: {
      enabled?: boolean;
      throttleMessages?: number;
      strongEventBypass?: boolean;
    };
  };
  voice?: {
    enabled?: boolean;
    provider?: string;
    openai?: {
      apiKey?: string;
      model?: string;
      voice?: string;
      instructions?: string;
    };
    elevenlabs?: {
      apiKey?: string;
      model?: string;
      outputFormat?: string;
    };
  };
}

export interface AppSettingsResult {
  ok?: boolean;
  saved?: boolean;
  config?: AppConfigView;
  configPath?: string;
  userDataDir?: string;
}
