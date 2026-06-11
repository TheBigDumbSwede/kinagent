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

export type StorybookOrganizationMode = "scene" | "day" | "event" | "relationship_arc";
export type StorybookLength = "compact" | "medium";
export type StorybookQuoteMode = "direct_quotes" | "paraphrase_only";

export interface StorybookExportRequest extends ChatExportRequest {
  kinId?: string;
  groupId?: string;
  organizationMode?: StorybookOrganizationMode;
  length?: StorybookLength;
  style?: string;
  quoteMode?: StorybookQuoteMode;
}

export interface StorybookExportResult {
  ok?: boolean;
  canceled?: boolean;
  jobId?: string;
  previewPath?: string;
  filePath?: string;
  title?: string;
  chapterCount?: number;
  warningCount?: number;
  opened?: boolean;
  openError?: string;
}

export interface StorybookExportProgress {
  jobId?: string;
  stage?: string;
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
  protocolVersion?: number;
  authenticatedSessionCount?: number;
  lastReadyAt: string | null;
  lastPollAt: string | null;
  lastAckAt?: string | null;
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
  generateStorybook(input: StorybookExportRequest): Promise<StorybookExportResult>;
  saveStorybookPdf(input: { jobId: string }): Promise<StorybookExportResult>;
  listGroupBackgroundSuggestions(): Promise<GroupBackgroundSuggestionSummary[]>;
  dismissGroupBackgroundSuggestion(input: { id: string }): Promise<unknown>;
  generateGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  applyGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  getCapturedGroup(input: { groupId: string }): Promise<CapturedGroupSummary & { fields?: CapturedFieldSummary[] }>;
  saveSettings(input: AppSettingsFormValue): Promise<AppSettingsResult>;
  pruneProfileData(): Promise<ProfileDataPruneResult>;
  clearSavedSession(): Promise<ProfileDataActionResult>;
  clearCache(): Promise<ProfileDataActionResult>;
  setCaptureVaultEnabled(input: { enabled: boolean }): Promise<CaptureVaultActionResult>;
  unlockCaptureVault(): Promise<CaptureVaultActionResult>;
  openProfileFolder(): Promise<string>;
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
  getGroupBackgroundPreference(input: { groupId: string }): Promise<GroupBackgroundPreferenceResult>;
  setGroupBackgroundPreference(input: {
    groupId: string;
    preference: GroupBackgroundPreference;
  }): Promise<GroupBackgroundPreferenceResult>;
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
  storybookSaving: boolean;
  storybookJobId: string | null;
  storybookPreviewPath: string | null;
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
  storybookOrganizationInput: HTMLSelectElement;
  storybookLengthInput: HTMLSelectElement;
  storybookStyleInput: HTMLSelectElement;
  storybookQuoteModeInput: HTMLSelectElement;
  storybookPrivacyInput: HTMLInputElement;
  storybookGenerateButton: HTMLButtonElement;
  storybookSavePdfButton: HTMLButtonElement;
  storybookProgress: HTMLProgressElement;
  storybookStatusLine: HTMLElement;
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

export interface GroupBackgroundPreference {
  enabled: boolean;
  autonomous: boolean;
}

export interface GroupBackgroundPreferenceResult {
  ok?: boolean;
  preference?: GroupBackgroundPreference;
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

export interface SceneLedgerFactSummary {
  id?: string | null;
  layer?: "scene_state" | string;
  kind?: string | null;
  value?: string | null;
  confidence?: string | null;
  status?: string | null;
  reviewStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  firstObservedAt?: string | null;
  lastObservedAt?: string | null;
  provenance?: {
    sourceType?: string | null;
    sourceDocumentId?: string | null;
    sourceTimestamp?: string | null;
    observedAt?: string | null;
    evidence?: unknown[];
  } | null;
  reason?: string | null;
}

export interface SceneLedgerSummary {
  sourceKey?: string | null;
  scope?: "kin" | "group" | string;
  kinId?: string | null;
  groupId?: string | null;
  sceneStartedAt?: string | null;
  updatedAt?: string | null;
  facts?: SceneLedgerFactSummary[];
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

export interface ProfileDataCategory {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
}

export interface ProfileDataReport {
  userDataDir: string;
  dataDir: string;
  totalBytes: number;
  totalFiles: number;
  categories: ProfileDataCategory[];
}

export interface ProfileDataPruneResult {
  ok?: boolean;
  journalSuggestionsRemoved?: number;
  groupBackgroundSuggestionsRemoved?: number;
  chatDynamismSuggestionsRemoved?: number;
  orphanedGroupBackgroundImagesRemoved?: number;
  report?: ProfileDataReport;
}

export interface ProfileDataActionResult {
  ok?: boolean;
  removed?: boolean;
  removedBytes?: number;
  removedFiles?: number;
  report?: ProfileDataReport;
}

export interface CaptureVaultStatus {
  enabled: boolean;
  available: boolean;
  locked: boolean;
  unlocked: boolean;
  captureDir: string;
  vaultDir: string;
  archivePath: string;
  metadataPath: string;
  lastError?: string;
}

export interface CaptureVaultActionResult {
  ok?: boolean;
  action?: "enabled" | "disabled" | "locked" | "unlocked";
  changed?: boolean;
  status?: CaptureVaultStatus;
}

export interface AppSettingsResult {
  ok?: boolean;
  saved?: boolean;
  config?: AppConfigView;
  configPath?: string;
  userDataDir?: string;
  dataReport?: ProfileDataReport;
  secureSecrets?: {
    available: boolean;
    path: string;
    storedKeys: string[];
  } | null;
  browserSessionEncryption?: {
    available: boolean;
    encrypted: boolean;
  } | null;
  captureVault?: CaptureVaultStatus | null;
}
