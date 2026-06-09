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

export type BrowserIntegrationTarget = "chrome" | "edge" | "firefox";

export interface BrowserIntegrationSettings {
  targets: BrowserIntegrationTarget[];
  chromiumExtensionIds: string[];
  firefoxExtensionIds: string[];
}

export interface BrowserIntegrationTargetStatus {
  target: BrowserIntegrationTarget;
  selected: boolean;
  configured: boolean;
  manifestPath: string;
  manifestExists: boolean;
  registryKey: string;
  registryValue: string | null;
  registered: boolean;
  error?: string;
}

export interface BrowserBridgeStatus {
  connected: boolean;
  queuedCommandCount: number;
  lastReadyAt: string | null;
  lastPollAt: string | null;
}

export interface BrowserIntegrationStatus {
  ok?: boolean;
  platform: string;
  hostName: string;
  hostPath: string;
  hostExists: boolean;
  manifestDir: string;
  settings: BrowserIntegrationSettings;
  validationErrors: string[];
  targets: BrowserIntegrationTargetStatus[];
  bridge?: BrowserBridgeStatus;
}

export interface KinagentApi {
  getBrowserIntegrationStatus(): Promise<BrowserIntegrationStatus>;
  saveBrowserIntegrationSettings(input: BrowserIntegrationSettings): Promise<BrowserIntegrationStatus>;
  registerBrowserIntegration(input: BrowserIntegrationSettings): Promise<BrowserIntegrationStatus>;
  unregisterBrowserIntegration(): Promise<BrowserIntegrationStatus>;
  testBrowserIntegrationNotice(): Promise<BrowserIntegrationStatus>;
  testBrowserIntegrationReload(): Promise<BrowserIntegrationStatus>;
  analyzeKin(input: { kinId: string }): Promise<KinAnalysisResult>;
  exportKinChat(input: ChatExportRequest & { kinId: string }): Promise<ChatExportResult>;
  exportGroupChat(input: ChatExportRequest & { groupId: string }): Promise<ChatExportResult>;
  listGroupBackgroundSuggestions(): Promise<GroupBackgroundSuggestionSummary[]>;
  dismissGroupBackgroundSuggestion(input: { id: string }): Promise<unknown>;
  generateGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  applyGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  getCapturedGroup(input: { groupId: string }): Promise<CapturedGroupSummary & { fields?: CapturedFieldSummary[] }>;
  saveSettings(input: AppSettingsFormValue): Promise<AppSettingsResult>;
  setKinVoicePreference(input: { kinId: string; preference: KinVoicePreference }): Promise<KinVoicePreferenceResult>;
  setGroupSoundscapePreference(input: {
    groupId: string;
    preference: GroupSoundscapePreference;
  }): Promise<GroupSoundscapePreferenceResult>;
  getGroupGamingPreference(input: { groupId: string }): Promise<GroupGamingPreferenceResult>;
  setGroupGamingPreference(input: {
    groupId: string;
    preference: GroupGamingPreference;
  }): Promise<GroupGamingPreferenceResult>;
  approveGroupGamingKeeperSuggestion(input: { groupId: string }): Promise<GroupGamingPreferenceResult>;
  importCampaignPack(): Promise<CampaignPackImportResult>;
  forceLocalScenePrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forceSoundscapePrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forcePreviouslyOnPrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forceGroupBackgroundPrewarm(input: { groupId: string }): Promise<{ ok: boolean }>;
  setGroupBackgroundSettings(input: GroupBackgroundSettings): Promise<GroupBackgroundSettingsResult>;
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

export interface GroupSummary {
  groupId?: string | null;
  name?: string | null;
}

export interface GroupBackgroundSuggestionSummary {
  id: string;
  groupId: string;
  aiId?: string | null;
  title: string;
  prompt: string;
  negativePrompt?: string;
  targetCurrentScene?: string;
  sceneSummary?: string;
  visualStyle?: string;
  reason: string;
  evidence?: string[];
  significance: number;
  sourceDocumentId: string;
  sourceTimestamp?: string | null;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "dismissed" | "stale";
  generatedImage?: {
    path: string;
    mimeType: string;
    model: string;
    size: string;
    generatedAt: string;
  };
  generationError?: string;
  generationErrorAt?: string;
  appliedBackgroundPath?: string;
  appliedAt?: string;
  applyError?: string;
  applyErrorAt?: string;
}

export interface GroupBackgroundSettings {
  enabled: boolean;
  autonomous: boolean;
}

export interface GroupBackgroundSettingsResult {
  ok?: boolean;
  settings?: GroupBackgroundSettings;
}

export interface KinSubscriptionSummary {
  kin?: KinSummary;
  enabled?: boolean;
  running?: boolean;
  ambientContextEnabled?: boolean;
  chatDynamism?: unknown;
  soundscape?: KinSoundscapePreference;
}

export type SubscriptionSummary = KinSubscriptionSummary;

export interface GroupSubscriptionSummary {
  group?: GroupSummary;
  enabled?: boolean;
  running?: boolean;
  soundscape?: GroupSoundscapePreference;
}

export type GamingAutomationMode = "observe" | "suggest" | "autonomous";

export interface GroupGamingPreference {
  enabled: boolean;
  campaignId?: string;
  mysteryId?: string;
  automationMode: GamingAutomationMode;
}

export interface CampaignPackSummary {
  id: string;
  title: string;
  genre?: string;
  tone?: string[];
  rulesetStyle: string;
  recommendedGroupSize?: string;
  contentWarnings?: string[];
  license: string;
  attribution?: string;
  source: "builtin" | "local";
  mysteries: Array<{
    id: string;
    title: string;
    hook: string;
    countdownStages: number;
    clueCount: number;
    threatCount: number;
  }>;
  threatCount: number;
}

export interface GroupCampaignStateSummary {
  groupId: string;
  campaignId: string;
  mysteryId: string;
  status: "initialized" | "active" | "paused" | "completed";
  initializedAt: string;
  updatedAt: string;
  currentCountdownIndex: number;
  discoveredClueIds: string[];
  revealedThreatIds: string[];
  revealedNpcIds: string[];
  visitedLocationIds: string[];
  notes: string[];
  processedSourceDocumentIds: string[];
  rollHistory: Array<{
    sourceDocumentId: string;
    resolvedAt: string;
    automationMode: GamingAutomationMode;
    request: {
      moveId: string;
      actor?: string;
      modifier: number;
      prompt?: string;
      reason?: string;
    };
    result: {
      moveId: string;
      moveName: string;
      actor?: string;
      dice: [number, number];
      modifier: number;
      total: number;
      outcome: "10+" | "7-9" | "6-";
      outcomeText: string;
    };
    message: string;
    sent?: {
      ok: boolean;
      status: number;
      requestId?: string;
      idempotencyKey?: string;
      responseText?: string;
    };
  }>;
  pendingRollRequest?: {
    sourceDocumentId: string;
    createdAt: string;
    automationMode: GamingAutomationMode;
    request: {
      moveId: string;
      actor?: string;
      modifier: number;
      prompt?: string;
      reason?: string;
    };
    confidence?: "low" | "medium" | "high";
    reason?: string;
  };
  pendingDecision?: {
    sourceDocumentId: string;
    createdAt: string;
    automationMode: GamingAutomationMode;
    keeperMessage?: string;
    pressureCategory?: string;
    confidence?: "low" | "medium" | "high";
    reason?: string;
  };
  lastKeeperMessage?: {
    text: string;
    sentAt: string;
    requestId: string;
    idempotencyKey: string;
    sourceDocumentId: string;
  };
}

export interface GroupGamingPreferenceResult {
  ok?: boolean;
  preference?: GroupGamingPreference;
  campaigns?: CampaignPackSummary[];
  activeState?: GroupCampaignStateSummary | null;
}

export interface CampaignPackImportResult {
  ok?: boolean;
  canceled?: boolean;
  campaign?: CampaignPackSummary;
  installedPath?: string;
}

export interface JournalSuggestionSummary {
  id?: string | null;
  aiId?: string | null;
  status?: string | null;
  action?: "create" | "delete" | string | null;
  title?: string | null;
  strongEvent?: boolean;
  category?: string | null;
  categoryDetail?: string | null;
  createdAt?: string | null;
  targetJournalEntry?: string | null;
  targetJournalTitle?: string | null;
  targetJournalEntryId?: string | null;
  durabilityReason?: string | null;
  evidence?: unknown[];
  keyphrases?: unknown[];
  entry?: string | null;
  createdJournalEntryId?: string | null;
  createdJournalEntryCreated?: string | null;
  createdJournalEntryResolvedAt?: string | null;
  staleAt?: string | null;
  staleReason?: string | null;
  sourceInvalidatedAt?: string | null;
  sourceInvalidationReason?: string | null;
}

export interface LocalSceneStateSummary {
  scope?: "kin" | "group" | string;
  kinId?: string | null;
  groupId?: string | null;
  latestSpeakerKinId?: string | null;
  updatedAt?: string | null;
  sourceDocumentId?: string | null;
  sourceTimestamp?: string | null;
  location?: string | null;
  timeOfDay?: string | null;
  mood?: string | null;
  activity?: string | null;
  tension?: number | null;
  privacy?: string | null;
  soundscape?: Record<string, unknown> | null;
  visualPalette?: Record<string, unknown> | null;
  suggestedUiAccent?: string | null;
  evidence?: unknown[];
  reason?: string | null;
}

export interface PreviouslyOnBriefSummary {
  scope?: "kin" | "group" | string;
  kinId?: string | null;
  groupId?: string | null;
  latestSpeakerKinId?: string | null;
  updatedAt?: string | null;
  sourceDocumentId?: string | null;
  sourceTimestamp?: string | null;
  facts?: unknown[];
  inferredTone?: string | null;
  unresolvedThreads?: unknown[];
  suggestedOpeningFrame?: string | null;
  recap?: string | null;
  confidence?: "low" | "medium" | "high" | string | null;
}

export interface PrewarmSourceSummary {
  sourceKey?: string | null;
  lastPrewarmMessageId?: string | null;
  lastPrewarmTimestamp?: string | null;
  localSceneReady?: boolean;
  soundscapeReady?: boolean;
  previouslyOnReady?: boolean;
  lastLocalScenePrewarmAt?: string | null;
  lastSoundscapePrewarmAt?: string | null;
  lastPreviouslyOnPrewarmAt?: string | null;
  localSceneChatHistoryCursorTimestamp?: number | null;
  soundscapeChatHistoryCursorTimestamp?: number | null;
  previouslyOnChatHistoryCursorTimestamp?: number | null;
  chatHistoryCursorTimestamp?: number | null;
  updatedAt?: string | null;
}

export interface CapturedHistoryEntry {
  hash?: string | null;
  shortHash?: string | null;
  committedAt?: string | null;
  subject?: string | null;
  summary?: string | null;
  content?: string | null;
  changed?: boolean;
  previousShortHash?: string;
  addedLines?: number;
  removedLines?: number;
  characterDelta?: number;
}

export interface CapturedFieldSummary {
  key?: string | null;
  label?: string | null;
  available?: boolean;
  content?: string | null;
  history?: CapturedHistoryEntry[];
}

export interface CapturedKinSummary {
  ok?: boolean;
  kinId?: string | null;
  folderName?: string | null;
  error?: string | null;
}

export interface CapturedGroupSummary {
  ok?: boolean;
  groupId?: string | null;
  folderName?: string | null;
  error?: string | null;
}

export interface DetailStat {
  label: string;
  value: string;
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

export interface KinSoundscapePreference {
  enabled: boolean;
}

export type GroupSoundscapePreference = KinSoundscapePreference;

export interface GroupSoundscapePreferenceResult {
  ok?: boolean;
  soundscape?: GroupSoundscapePreference;
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
  soundscape?: KinSoundscapePreference;
}

export interface KinVoicePreferenceResult {
  ok?: boolean;
  globalEnabled?: boolean;
  configuredProviders?: Record<string, boolean>;
  openAiVoiceOptions?: string[];
  preference?: KinVoicePreference;
  soundscape?: KinSoundscapePreference;
}

export interface AppSettingsFormValue {
  kindroidApiKey: string;
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
  hermesGroupBackgroundsEnabled: boolean;
  hermesGroupBackgroundsAutonomous: boolean;
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
  kindroid?: {
    apiKey?: string;
  };
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
    groupBackgrounds?: {
      suggestions?: {
        enabled?: boolean;
        autonomous?: boolean;
        minMessagesBetweenProposals?: number;
        minSignificance?: number;
      };
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
