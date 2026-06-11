import { analyzeSelectedKin, renderKinAnalysisProgress } from "./analysisPanel.js";
import { renderGroupExportTab, renderKinAnalyzeTab, renderKinExportTab } from "./actionPanels.js";
import { renderAppSettingsTab, saveAppSettings } from "./appSettingsForm.js";
import { createVoiceAudioPlayer, type VoiceAudioPayload } from "./audioPlayback.js";
import {
  registerBrowserIntegration,
  renderBrowserIntegrationTab,
  saveBrowserIntegration,
  unregisterBrowserIntegration
} from "./browserIntegrationPanel.js";
import {
  capturedDetailStats,
  renderDetailContent as renderCapturedDetailContent,
  renderDetailEmpty as renderCapturedDetailEmpty
} from "./capturedDetailPanel.js";
import { exportSelectedChat, renderChatExportProgress } from "./chatExportPanel.js";
import {
  journalSuggestionNotice,
  renderJournalSuggestions,
  renderJournalTabBadge,
  upsertJournalSuggestion
} from "./journalSuggestionsPanel.js";
import {
  groupBackgroundSuggestionNotice,
  renderGroupBackgroundPanel,
  upsertGroupBackgroundSuggestion
} from "./groupBackgroundPanel.js";
import {
  clearVisibleMonitorMessages,
  handleMonitorLine,
  renderMessageList,
  renderMonitorState
} from "./monitorMessages.js";
import {
  markGroupSubscriptionRunning,
  markKinSubscriptionRunning,
  renderGroupSubscriptions,
  renderKinSubscriptions
} from "./subscriptionLists.js";
import {
  handleDetailTabsClick,
  handleGroupSettingTabsClick,
  handleKinDetailTabsClick,
  handleSettingTabsClick,
  modeForTab,
  renderTabNavigation,
  subtitleForDetailMode,
  tabLabelFor
} from "./tabNavigation.js";
import {
  renderKinHermesTab,
  renderVoiceProviderFields,
  renderVoiceTab,
  saveSelectedKinAmbient,
  saveSelectedKinVoice,
  syncChatDynamismRangeLabels
} from "./voiceHermesForms.js";
import { renderPreviouslyOnPanel as renderPreviouslyOnPanelContent } from "./previouslyOnPanel.js";
import { SoundscapeController } from "./SoundscapeController.js";
import { shouldDeactivateActiveSoundscape, soundscapeKeyFromPayload } from "./SoundscapeActivation.js";
import { describeSoundscapeLayerSample } from "./SoundscapeSampleSelection.js";
import { silentSoundscapeState, type SoundscapeState } from "../../soundscape/SoundscapeState.js";
import type {
  AppSettingsResult,
  AppSettingsFormValue,
  BrowserIntegrationSettings,
  BrowserIntegrationStatus,
  CapturedFieldSummary,
  CapturedGroupSummary,
  CapturedKinSummary,
  ChatExportProgress,
  ChatExportRequest,
  ChatExportResult,
  CampaignPackImportResult,
  DetailStat,
  CampaignPackSummary,
  GroupGamingPreference,
  GroupGamingPreferenceResult,
  GroupCampaignStateSummary,
  GroupBackgroundPreference,
  GroupBackgroundPreferenceResult,
  GroupBackgroundSuggestionSummary,
  GroupSoundscapePreference,
  GroupSoundscapePreferenceResult,
  GroupSubscriptionSummary,
  GroupSummary,
  JournalSuggestionSummary,
  KinAnalysisResult,
  KinAnalysisProgress,
  KinAmbientPreferenceResult,
  KinChatDynamismPreference,
  KinSummary,
  KinVoicePreference,
  KinSubscriptionSummary,
  KinVoicePreferenceResult,
  LocalSceneStateSummary,
  PrewarmSourceSummary,
  PreviouslyOnBriefSummary,
  CaptureVaultActionResult,
  ProfileDataActionResult,
  ProfileDataPruneResult,
  SceneLedgerFactSummary,
  SceneLedgerSummary
} from "./rendererTypes.js";
import type { MonitorMessage } from "./monitorMessages.js";

interface ScopedSoundscapeUpdate {
  scope: "kin" | "group";
  kinId?: string;
  groupId?: string;
  documentId?: string;
  reason?: string;
  state?: SoundscapeState;
}

interface CapturedKinResult extends CapturedKinSummary {
  fields?: CapturedFieldSummary[];
}

interface CapturedGroupResult extends CapturedGroupSummary {
  fields?: CapturedFieldSummary[];
}

interface RefreshState {
  ok?: boolean;
  error?: string;
}

interface RendererState {
  kins: KinSummary[];
  subscriptions: KinSubscriptionSummary[];
  groups: GroupSummary[];
  groupSubscriptions: GroupSubscriptionSummary[];
  monitorRunning: boolean;
  sessionAvailable: boolean;
  kinRefresh: RefreshState | null;
  groupRefresh: RefreshState | null;
  kinsExpanded: boolean;
  groupsExpanded: boolean;
  selectedKinId: string | null;
  selectedGroupId: string | null;
  selectedKinCapture: CapturedKinResult | null;
  selectedGroupCapture: CapturedGroupResult | null;
  selectedKinVoice: KinVoicePreferenceResult | null;
  selectedGroupSoundscape: GroupSoundscapePreferenceResult | null;
  selectedGroupGaming: GroupGamingPreferenceResult | null;
  selectedGroupBackground: GroupBackgroundPreferenceResult | null;
  selectedKinAmbient: KinAmbientPreferenceResult | null;
  journalSuggestions: JournalSuggestionSummary[];
  groupBackgroundSuggestions: GroupBackgroundSuggestionSummary[];
  localScenes: LocalSceneStateSummary[];
  sceneLedgers: SceneLedgerSummary[];
  previouslyOnBriefs: PreviouslyOnBriefSummary[];
  prewarmStates: PrewarmSourceSummary[];
  localSceneForceSaving: boolean;
  previouslyOnForceSaving: boolean;
  journalSavingId: string | null;
  journalError: string | null;
  groupBackgroundLoading: boolean;
  groupBackgroundForceSaving: boolean;
  groupBackgroundSaving: boolean;
  groupBackgroundSavingId: string | null;
  groupBackgroundSavingAction: "generate" | "apply" | "dismiss" | null;
  groupBackgroundError: string | null;
  captureLoading: boolean;
  captureError: string | null;
  voiceLoading: boolean;
  groupSoundscapeLoading: boolean;
  groupSoundscapeSaving: boolean;
  groupSoundscapeForceSaving: boolean;
  groupSoundscapeError: string | null;
  groupGamingLoading: boolean;
  groupGamingSaving: boolean;
  groupGamingApproving: boolean;
  groupGamingImporting: boolean;
  groupGamingError: string | null;
  voiceError: string | null;
  voiceSaving: boolean;
  soundscapeForceSaving: boolean;
  ambientLoading: boolean;
  ambientError: string | null;
  ambientSaving: boolean;
  activeTab: string;
  selectedHistoryHash: string | null;
  monitorMessages: MonitorMessage[];
  appSettings: AppSettingsResult | null;
  appSettingsLoading: boolean;
  appSettingsSaving: boolean;
  appSettingsError: string | null;
  browserIntegration: BrowserIntegrationStatus | null;
  browserIntegrationLoading: boolean;
  browserIntegrationSaving: boolean;
  browserIntegrationError: string | null;
  soundscapeUpdates: Record<string, ScopedSoundscapeUpdate>;
  activeSoundscapeKey: string | null;
  lastSoundscapeCue: { key: string; label: string; expiresAt: number } | null;
  kinAnalysisRunning: boolean;
  kinAnalysisJobId: string | null;
  kinAnalysisReport: string;
  chatExportSaving: boolean;
  chatExportJobId: string | null;
}

interface RendererElements {
  sessionLine: HTMLElement;
  firebaseStatus: HTMLElement;
  appCheckStatus: HTMLElement;
  expiryStatus: HTMLElement;
  kinRefreshLine: HTMLElement;
  kinSubscriptionList: HTMLElement;
  groupRefreshLine: HTMLElement;
  groupSubscriptionList: HTMLElement;
  activityTitle: HTMLElement;
  detailTabs: HTMLElement;
  kinDetailTabs: HTMLElement;
  groupDetailTabs: HTMLElement;
  settingTabs: HTMLElement;
  groupSettingTabs: HTMLElement;
  monitorPane: HTMLElement;
  detailPane: HTMLElement;
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  detailStats: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  previouslyOnPanel: HTMLElement;
  directorPanel: HTMLElement;
  fieldContent: HTMLElement;
  localSceneActions: HTMLElement;
  appSettingsForm: HTMLFormElement;
  browserIntegrationPanel: HTMLFormElement;
  appSettingsStatusLine: HTMLElement;
  appSettingsSaveButton: HTMLButtonElement;
  settingsPathLine: HTMLElement;
  settingsSecretStorageLine: HTMLElement;
  settingsDataStatusList: HTMLElement;
  settingsCaptureVaultEnabledInput: HTMLInputElement;
  settingsUnlockCaptureVaultButton: HTMLButtonElement;
  settingsOpenProfileButton: HTMLButtonElement;
  settingsPruneDataButton: HTMLButtonElement;
  settingsClearSessionButton: HTMLButtonElement;
  settingsClearCacheButton: HTMLButtonElement;
  settingsKindroidApiKeyInput: HTMLInputElement;
  settingsLogLevelInput: HTMLInputElement;
  settingsDedupeWindowInput: HTMLInputElement;
  settingsHermesEnabledInput: HTMLInputElement;
  settingsHermesBaseUrlInput: HTMLInputElement;
  settingsHermesAgentIdInput: HTMLInputElement;
  settingsHermesApiKeyInput: HTMLInputElement;
  settingsHermesCurrentSceneEnabledInput: HTMLInputElement;
  settingsHermesCurrentSceneMaxLengthInput: HTMLInputElement;
  settingsHermesJournalEnabledInput: HTMLInputElement;
  settingsHermesJournalBypassInput: HTMLInputElement;
  settingsHermesJournalThrottleInput: HTMLInputElement;
  settingsVoiceEnabledInput: HTMLInputElement;
  settingsVoiceProviderInput: HTMLSelectElement;
  settingsOpenAiApiKeyInput: HTMLInputElement;
  settingsOpenAiModelInput: HTMLInputElement;
  settingsOpenAiVoiceInput: HTMLInputElement;
  settingsOpenAiInstructionsInput: HTMLTextAreaElement;
  settingsElevenLabsApiKeyInput: HTMLInputElement;
  settingsElevenLabsModelInput: HTMLInputElement;
  settingsElevenLabsOutputFormatInput: HTMLInputElement;
  browserIntegrationChromeInput: HTMLInputElement;
  browserIntegrationEdgeInput: HTMLInputElement;
  browserIntegrationFirefoxInput: HTMLInputElement;
  browserIntegrationChromiumIdsInput: HTMLInputElement;
  browserIntegrationFirefoxIdsInput: HTMLInputElement;
  browserIntegrationStatusLine: HTMLElement;
  browserIntegrationStatusList: HTMLElement;
  browserIntegrationNoticeButton: HTMLButtonElement;
  browserIntegrationReloadButton: HTMLButtonElement;
  browserIntegrationSaveButton: HTMLButtonElement;
  browserIntegrationRegisterButton: HTMLButtonElement;
  browserIntegrationUnregisterButton: HTMLButtonElement;
  voiceForm: HTMLFormElement;
  groupAudioPanel: HTMLElement;
  groupBackgroundPanel: HTMLElement;
  groupBackgroundEnabledInput: HTMLInputElement;
  groupBackgroundAutonomousInput: HTMLInputElement;
  groupBackgroundSaveButton: HTMLButtonElement;
  groupBackgroundStatusLine: HTMLElement;
  groupBackgroundActions: HTMLElement;
  groupBackgroundSuggestionList: HTMLElement;
  groupSoundscapeEnabledInput: HTMLInputElement;
  groupSoundscapeStatusLine: HTMLElement;
  groupSoundscapeLayerList: HTMLElement;
  groupSoundscapeSaveButton: HTMLButtonElement;
  groupSoundscapeForcePrewarmButton: HTMLButtonElement;
  groupGamingPanel: HTMLElement;
  groupGamingEnabledInput: HTMLInputElement;
  groupGamingCampaignInput: HTMLSelectElement;
  groupGamingMysteryInput: HTMLSelectElement;
  groupGamingAutomationInput: HTMLSelectElement;
  groupGamingStatusLine: HTMLElement;
  groupGamingCampaignSummary: HTMLElement;
  groupGamingStateList: HTMLElement;
  groupGamingSaveButton: HTMLButtonElement;
  groupGamingApproveButton: HTMLButtonElement;
  groupGamingImportButton: HTMLButtonElement;
  kinHermesForm: HTMLFormElement;
  ambientContextEnabledInput: HTMLInputElement;
  chatDynamismCurrentValue: HTMLElement;
  chatDynamismRangeControl: HTMLElement;
  chatDynamismEnabledInput: HTMLInputElement;
  chatDynamismMinInput: HTMLInputElement;
  chatDynamismMaxInput: HTMLInputElement;
  chatDynamismMinValue: HTMLElement;
  chatDynamismMaxValue: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  kinAnalyzeButton: HTMLButtonElement;
  kinAnalyzeProgress: HTMLProgressElement;
  kinAnalyzeStatusLine: HTMLElement;
  kinAnalyzeReport: HTMLElement;
  chatExportPanel: HTMLElement;
  chatExportTitle: HTMLElement;
  chatExportDescription: HTMLElement;
  chatExportFromInput: HTMLInputElement;
  chatExportToInput: HTMLInputElement;
  chatExportRangeButton: HTMLButtonElement;
  chatExportAllButton: HTMLButtonElement;
  chatExportProgress: HTMLProgressElement;
  chatExportStatusLine: HTMLElement;
  kinHermesStatusLine: HTMLElement;
  kinHermesSaveButton: HTMLButtonElement;
  voiceEnabledInput: HTMLInputElement;
  filterNarrationInput: HTMLInputElement;
  voiceProviderInput: HTMLSelectElement;
  openAiVoiceLabel: HTMLElement;
  openAiVoiceInput: HTMLSelectElement;
  elevenLabsVoiceLabel: HTMLElement;
  elevenLabsVoiceInput: HTMLInputElement;
  narrationDelimiterInput: HTMLInputElement;
  openAiInstructionsInput: HTMLTextAreaElement;
  voiceStatusLine: HTMLElement;
  voiceSaveButton: HTMLButtonElement;
  soundscapeEnabledInput: HTMLInputElement;
  soundscapeStatusLine: HTMLElement;
  soundscapeLayerList: HTMLElement;
  soundscapeForcePrewarmButton: HTMLButtonElement;
  timelineList: HTMLElement;
  timeline: HTMLElement;
  monitorLine: HTMLElement;
  messageList: HTMLElement;
  loginStartButton: HTMLButtonElement;
  loginSaveButton: HTMLButtonElement;
  openKindroidButton: HTMLButtonElement;
  toggleKinsButton: HTMLButtonElement;
  refreshKinsButton: HTMLButtonElement;
  toggleGroupsButton: HTMLButtonElement;
  refreshGroupsButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
}

interface DesktopStatus {
  kins?: KinSummary[];
  subscriptions?: KinSubscriptionSummary[];
  groups?: GroupSummary[];
  groupSubscriptions?: GroupSubscriptionSummary[];
  journalSuggestions?: JournalSuggestionSummary[];
  groupBackgroundSuggestions?: GroupBackgroundSuggestionSummary[];
  localScenes?: LocalSceneStateSummary[];
  sceneLedgers?: SceneLedgerSummary[];
  previouslyOn?: PreviouslyOnBriefSummary[];
  soundscapes?: ScopedSoundscapeUpdate[];
  prewarmStates?: PrewarmSourceSummary[];
  monitorRunning?: boolean;
  session?: {
    available?: boolean;
    hasFirebaseAuth?: boolean;
    expirationIso?: string;
  };
  appCheckPresent?: boolean;
  kinRefresh?: RefreshState | null;
  groupRefresh?: RefreshState | null;
}

interface RendererEvent {
  channel: string;
  payload?: EventPayload;
}

interface EventPayload {
  [key: string]: unknown;
  error?: string;
  groupId?: string;
  kinId?: string;
  line?: string;
  message?: string;
  ok?: boolean;
  type?: string;
  warmed?: boolean;
}

interface RendererApi {
  getStatus(): Promise<DesktopStatus>;
  getSettings(): Promise<AppSettingsResult>;
  saveSettings(input: AppSettingsFormValue): Promise<AppSettingsResult>;
  pruneProfileData(): Promise<ProfileDataPruneResult>;
  clearSavedSession(): Promise<ProfileDataActionResult>;
  clearCache(): Promise<ProfileDataActionResult>;
  setCaptureVaultEnabled(input: { enabled: boolean }): Promise<CaptureVaultActionResult>;
  unlockCaptureVault(): Promise<CaptureVaultActionResult>;
  openProfileFolder(): Promise<string>;
  getBrowserIntegrationStatus(): Promise<BrowserIntegrationStatus>;
  saveBrowserIntegrationSettings(input: BrowserIntegrationSettings): Promise<BrowserIntegrationStatus>;
  registerBrowserIntegration(input: BrowserIntegrationSettings): Promise<BrowserIntegrationStatus>;
  unregisterBrowserIntegration(): Promise<BrowserIntegrationStatus>;
  testBrowserIntegrationNotice(): Promise<BrowserIntegrationStatus>;
  testBrowserIntegrationReload(): Promise<BrowserIntegrationStatus>;
  openKindroid(): Promise<unknown>;
  startLogin(): Promise<unknown>;
  saveLogin(): Promise<unknown>;
  setKinEnabled(input: { kinId: string; enabled: boolean }): Promise<unknown>;
  refreshKins(): Promise<unknown>;
  setGroupEnabled(input: { groupId: string; enabled: boolean }): Promise<unknown>;
  refreshGroups(): Promise<unknown>;
  getCapturedKin(input: { kinId: string }): Promise<CapturedKinResult>;
  getCapturedGroup(input: { groupId: string }): Promise<CapturedGroupResult>;
  listJournalSuggestions(): Promise<JournalSuggestionSummary[]>;
  acceptJournalSuggestion(input: { id: string }): Promise<unknown>;
  deleteInvalidatedJournalSuggestion(input: { id: string }): Promise<unknown>;
  dismissJournalSuggestion(input: { id: string }): Promise<unknown>;
  listGroupBackgroundSuggestions(): Promise<GroupBackgroundSuggestionSummary[]>;
  dismissGroupBackgroundSuggestion(input: { id: string }): Promise<unknown>;
  generateGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  applyGroupBackgroundImage(input: { id: string }): Promise<unknown>;
  getGroupBackgroundPreference(input: { groupId: string }): Promise<GroupBackgroundPreferenceResult>;
  setGroupBackgroundPreference(input: {
    groupId: string;
    preference: GroupBackgroundPreference;
  }): Promise<GroupBackgroundPreferenceResult>;
  getKinVoicePreference(input: { kinId: string }): Promise<KinVoicePreferenceResult>;
  setKinVoicePreference(input: { kinId: string; preference: KinVoicePreference }): Promise<KinVoicePreferenceResult>;
  getGroupSoundscapePreference(input: { groupId: string }): Promise<GroupSoundscapePreferenceResult>;
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
  getKinAmbientPreference(input: { kinId: string }): Promise<KinAmbientPreferenceResult>;
  setKinAmbientPreference(input: {
    kinId: string;
    enabled: boolean;
    chatDynamism: KinChatDynamismPreference;
  }): Promise<KinAmbientPreferenceResult>;
  exportKinChat(input: ChatExportRequest & { kinId: string }): Promise<ChatExportResult>;
  exportGroupChat(input: ChatExportRequest & { groupId: string }): Promise<ChatExportResult>;
  analyzeKin(input: { kinId: string }): Promise<KinAnalysisResult>;
  forceLocalScenePrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forceSoundscapePrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forcePreviouslyOnPrewarm(input: { scope: "kin" | "group"; id: string }): Promise<{ ok: boolean }>;
  forceGroupBackgroundPrewarm(input: { groupId: string }): Promise<{ ok: boolean }>;
  readSoundscapeAsset(input: { path: string }): Promise<ArrayBuffer | Uint8Array | number[]>;
  onEvent(callback: (message: RendererEvent) => void): () => void;
}

declare global {
  interface Window {
    kinagent: RendererApi;
  }
}

function query<T extends Element>(selector: string): T {
  return document.querySelector(selector) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bytesToArrayBuffer(value: ArrayBuffer | Uint8Array | number[]): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer as ArrayBuffer;
  }

  return Uint8Array.from(value).buffer as ArrayBuffer;
}

function payloadText(payload: EventPayload | undefined, fallback: string): string {
  if (payload?.error) {
    return payload.error;
  }

  return payload ? String(payload) : fallback;
}

const state: RendererState = {
  kins: [],
  subscriptions: [],
  groups: [],
  groupSubscriptions: [],
  monitorRunning: false,
  sessionAvailable: false,
  kinRefresh: null,
  groupRefresh: null,
  kinsExpanded: false,
  groupsExpanded: false,
  selectedKinId: null,
  selectedGroupId: null,
  selectedKinCapture: null,
  selectedGroupCapture: null,
  selectedKinVoice: null,
  selectedGroupSoundscape: null,
  selectedGroupGaming: null,
  selectedGroupBackground: null,
  selectedKinAmbient: null,
  journalSuggestions: [],
  groupBackgroundSuggestions: [],
  localScenes: [],
  sceneLedgers: [],
  previouslyOnBriefs: [],
  prewarmStates: [],
  localSceneForceSaving: false,
  previouslyOnForceSaving: false,
  journalSavingId: null,
  journalError: null,
  groupBackgroundLoading: false,
  groupBackgroundForceSaving: false,
  groupBackgroundSaving: false,
  groupBackgroundSavingId: null,
  groupBackgroundSavingAction: null,
  groupBackgroundError: null,
  captureLoading: false,
  captureError: null,
  voiceLoading: false,
  groupSoundscapeLoading: false,
  groupSoundscapeSaving: false,
  groupSoundscapeForceSaving: false,
  groupSoundscapeError: null,
  groupGamingLoading: false,
  groupGamingSaving: false,
  groupGamingApproving: false,
  groupGamingImporting: false,
  groupGamingError: null,
  voiceError: null,
  voiceSaving: false,
  soundscapeForceSaving: false,
  ambientLoading: false,
  ambientError: null,
  ambientSaving: false,
  activeTab: "monitor",
  selectedHistoryHash: null,
  monitorMessages: [],
  appSettings: null,
  appSettingsLoading: false,
  appSettingsSaving: false,
  appSettingsError: null,
  browserIntegration: null,
  browserIntegrationLoading: false,
  browserIntegrationSaving: false,
  browserIntegrationError: null,
  soundscapeUpdates: {},
  activeSoundscapeKey: null,
  lastSoundscapeCue: null,
  kinAnalysisRunning: false,
  kinAnalysisJobId: null,
  kinAnalysisReport: "",
  chatExportSaving: false,
  chatExportJobId: null
};

const captureRequestTimeoutMs = 12_000;
const maxMonitorMessages = 500;
const loginOnboardingMessage = "Use Open Login, then Save Session to begin.";
const chatDynamismSlider = {
  hardMin: 0.6,
  hardMax: 1.8,
  practicalMin: 0.8,
  practicalMax: 1.4
};

const elements: RendererElements = {
  sessionLine: query<HTMLElement>("#sessionLine"),
  firebaseStatus: query<HTMLElement>("#firebaseStatus"),
  appCheckStatus: query<HTMLElement>("#appCheckStatus"),
  expiryStatus: query<HTMLElement>("#expiryStatus"),
  kinRefreshLine: query<HTMLElement>("#kinRefreshLine"),
  kinSubscriptionList: query<HTMLElement>("#kinSubscriptionList"),
  groupRefreshLine: query<HTMLElement>("#groupRefreshLine"),
  groupSubscriptionList: query<HTMLElement>("#groupSubscriptionList"),
  activityTitle: query<HTMLElement>("#activityTitle"),
  detailTabs: query<HTMLElement>("#detailTabs"),
  kinDetailTabs: query<HTMLElement>("#kinDetailTabs"),
  groupDetailTabs: query<HTMLElement>("#groupDetailTabs"),
  settingTabs: query<HTMLElement>("#settingTabs"),
  groupSettingTabs: query<HTMLElement>("#groupSettingTabs"),
  monitorPane: query<HTMLElement>("#monitorPane"),
  detailPane: query<HTMLElement>("#detailPane"),
  kinDetailEmpty: query<HTMLElement>("#kinDetailEmpty"),
  kinDetailContent: query<HTMLElement>("#kinDetailContent"),
  detailStats: query<HTMLElement>("#detailStats"),
  journalSuggestionPanel: query<HTMLElement>("#journalSuggestionPanel"),
  previouslyOnPanel: query<HTMLElement>("#previouslyOnPanel"),
  directorPanel: query<HTMLElement>("#directorPanel"),
  fieldContent: query<HTMLElement>("#fieldContent"),
  localSceneActions: query<HTMLElement>("#localSceneActions"),
  appSettingsForm: query<HTMLFormElement>("#appSettingsForm"),
  browserIntegrationPanel: query<HTMLFormElement>("#browserIntegrationPanel"),
  appSettingsStatusLine: query<HTMLElement>("#appSettingsStatusLine"),
  appSettingsSaveButton: query<HTMLButtonElement>("#appSettingsSaveButton"),
  settingsPathLine: query<HTMLElement>("#settingsPathLine"),
  settingsSecretStorageLine: query<HTMLElement>("#settingsSecretStorageLine"),
  settingsDataStatusList: query<HTMLElement>("#settingsDataStatusList"),
  settingsCaptureVaultEnabledInput: query<HTMLInputElement>("#settingsCaptureVaultEnabledInput"),
  settingsUnlockCaptureVaultButton: query<HTMLButtonElement>("#settingsUnlockCaptureVaultButton"),
  settingsOpenProfileButton: query<HTMLButtonElement>("#settingsOpenProfileButton"),
  settingsPruneDataButton: query<HTMLButtonElement>("#settingsPruneDataButton"),
  settingsClearSessionButton: query<HTMLButtonElement>("#settingsClearSessionButton"),
  settingsClearCacheButton: query<HTMLButtonElement>("#settingsClearCacheButton"),
  settingsKindroidApiKeyInput: query<HTMLInputElement>("#settingsKindroidApiKeyInput"),
  settingsLogLevelInput: query<HTMLInputElement>("#settingsLogLevelInput"),
  settingsDedupeWindowInput: query<HTMLInputElement>("#settingsDedupeWindowInput"),
  settingsHermesEnabledInput: query<HTMLInputElement>("#settingsHermesEnabledInput"),
  settingsHermesBaseUrlInput: query<HTMLInputElement>("#settingsHermesBaseUrlInput"),
  settingsHermesAgentIdInput: query<HTMLInputElement>("#settingsHermesAgentIdInput"),
  settingsHermesApiKeyInput: query<HTMLInputElement>("#settingsHermesApiKeyInput"),
  settingsHermesCurrentSceneEnabledInput: query<HTMLInputElement>("#settingsHermesCurrentSceneEnabledInput"),
  settingsHermesCurrentSceneMaxLengthInput: query<HTMLInputElement>("#settingsHermesCurrentSceneMaxLengthInput"),
  settingsHermesJournalEnabledInput: query<HTMLInputElement>("#settingsHermesJournalEnabledInput"),
  settingsHermesJournalBypassInput: query<HTMLInputElement>("#settingsHermesJournalBypassInput"),
  settingsHermesJournalThrottleInput: query<HTMLInputElement>("#settingsHermesJournalThrottleInput"),
  settingsVoiceEnabledInput: query<HTMLInputElement>("#settingsVoiceEnabledInput"),
  settingsVoiceProviderInput: query<HTMLSelectElement>("#settingsVoiceProviderInput"),
  settingsOpenAiApiKeyInput: query<HTMLInputElement>("#settingsOpenAiApiKeyInput"),
  settingsOpenAiModelInput: query<HTMLInputElement>("#settingsOpenAiModelInput"),
  settingsOpenAiVoiceInput: query<HTMLInputElement>("#settingsOpenAiVoiceInput"),
  settingsOpenAiInstructionsInput: query<HTMLTextAreaElement>("#settingsOpenAiInstructionsInput"),
  settingsElevenLabsApiKeyInput: query<HTMLInputElement>("#settingsElevenLabsApiKeyInput"),
  settingsElevenLabsModelInput: query<HTMLInputElement>("#settingsElevenLabsModelInput"),
  settingsElevenLabsOutputFormatInput: query<HTMLInputElement>("#settingsElevenLabsOutputFormatInput"),
  browserIntegrationChromeInput: query<HTMLInputElement>("#browserIntegrationChromeInput"),
  browserIntegrationEdgeInput: query<HTMLInputElement>("#browserIntegrationEdgeInput"),
  browserIntegrationFirefoxInput: query<HTMLInputElement>("#browserIntegrationFirefoxInput"),
  browserIntegrationChromiumIdsInput: query<HTMLInputElement>("#browserIntegrationChromiumIdsInput"),
  browserIntegrationFirefoxIdsInput: query<HTMLInputElement>("#browserIntegrationFirefoxIdsInput"),
  browserIntegrationStatusLine: query<HTMLElement>("#browserIntegrationStatusLine"),
  browserIntegrationStatusList: query<HTMLElement>("#browserIntegrationStatusList"),
  browserIntegrationNoticeButton: query<HTMLButtonElement>("#browserIntegrationNoticeButton"),
  browserIntegrationReloadButton: query<HTMLButtonElement>("#browserIntegrationReloadButton"),
  browserIntegrationSaveButton: query<HTMLButtonElement>("#browserIntegrationSaveButton"),
  browserIntegrationRegisterButton: query<HTMLButtonElement>("#browserIntegrationRegisterButton"),
  browserIntegrationUnregisterButton: query<HTMLButtonElement>("#browserIntegrationUnregisterButton"),
  voiceForm: query<HTMLFormElement>("#voiceForm"),
  groupAudioPanel: query<HTMLElement>("#groupAudioPanel"),
  groupBackgroundPanel: query<HTMLElement>("#groupBackgroundPanel"),
  groupBackgroundEnabledInput: query<HTMLInputElement>("#groupBackgroundEnabledInput"),
  groupBackgroundAutonomousInput: query<HTMLInputElement>("#groupBackgroundAutonomousInput"),
  groupBackgroundSaveButton: query<HTMLButtonElement>("#groupBackgroundSaveButton"),
  groupBackgroundStatusLine: query<HTMLElement>("#groupBackgroundStatusLine"),
  groupBackgroundActions: query<HTMLElement>("#groupBackgroundActions"),
  groupBackgroundSuggestionList: query<HTMLElement>("#groupBackgroundSuggestionList"),
  groupSoundscapeEnabledInput: query<HTMLInputElement>("#groupSoundscapeEnabledInput"),
  groupSoundscapeStatusLine: query<HTMLElement>("#groupSoundscapeStatusLine"),
  groupSoundscapeLayerList: query<HTMLElement>("#groupSoundscapeLayerList"),
  groupSoundscapeSaveButton: query<HTMLButtonElement>("#groupSoundscapeSaveButton"),
  groupSoundscapeForcePrewarmButton: query<HTMLButtonElement>("#groupSoundscapeForcePrewarmButton"),
  groupGamingPanel: query<HTMLElement>("#groupGamingPanel"),
  groupGamingEnabledInput: query<HTMLInputElement>("#groupGamingEnabledInput"),
  groupGamingCampaignInput: query<HTMLSelectElement>("#groupGamingCampaignInput"),
  groupGamingMysteryInput: query<HTMLSelectElement>("#groupGamingMysteryInput"),
  groupGamingAutomationInput: query<HTMLSelectElement>("#groupGamingAutomationInput"),
  groupGamingStatusLine: query<HTMLElement>("#groupGamingStatusLine"),
  groupGamingCampaignSummary: query<HTMLElement>("#groupGamingCampaignSummary"),
  groupGamingStateList: query<HTMLElement>("#groupGamingStateList"),
  groupGamingSaveButton: query<HTMLButtonElement>("#groupGamingSaveButton"),
  groupGamingApproveButton: query<HTMLButtonElement>("#groupGamingApproveButton"),
  groupGamingImportButton: query<HTMLButtonElement>("#groupGamingImportButton"),
  kinHermesForm: query<HTMLFormElement>("#kinHermesForm"),
  ambientContextEnabledInput: query<HTMLInputElement>("#ambientContextEnabledInput"),
  chatDynamismCurrentValue: query<HTMLElement>("#chatDynamismCurrentValue"),
  chatDynamismRangeControl: query<HTMLElement>("#chatDynamismRangeControl"),
  chatDynamismEnabledInput: query<HTMLInputElement>("#chatDynamismEnabledInput"),
  chatDynamismMinInput: query<HTMLInputElement>("#chatDynamismMinInput"),
  chatDynamismMaxInput: query<HTMLInputElement>("#chatDynamismMaxInput"),
  chatDynamismMinValue: query<HTMLElement>("#chatDynamismMinValue"),
  chatDynamismMaxValue: query<HTMLElement>("#chatDynamismMaxValue"),
  kinAnalyzePanel: query<HTMLElement>("#kinAnalyzePanel"),
  kinAnalyzeButton: query<HTMLButtonElement>("#kinAnalyzeButton"),
  kinAnalyzeProgress: query<HTMLProgressElement>("#kinAnalyzeProgress"),
  kinAnalyzeStatusLine: query<HTMLElement>("#kinAnalyzeStatusLine"),
  kinAnalyzeReport: query<HTMLElement>("#kinAnalyzeReport"),
  chatExportPanel: query<HTMLElement>("#chatExportPanel"),
  chatExportTitle: query<HTMLElement>("#chatExportTitle"),
  chatExportDescription: query<HTMLElement>("#chatExportDescription"),
  chatExportFromInput: query<HTMLInputElement>("#chatExportFromInput"),
  chatExportToInput: query<HTMLInputElement>("#chatExportToInput"),
  chatExportRangeButton: query<HTMLButtonElement>("#chatExportRangeButton"),
  chatExportAllButton: query<HTMLButtonElement>("#chatExportAllButton"),
  chatExportProgress: query<HTMLProgressElement>("#chatExportProgress"),
  chatExportStatusLine: query<HTMLElement>("#chatExportStatusLine"),
  kinHermesStatusLine: query<HTMLElement>("#kinHermesStatusLine"),
  kinHermesSaveButton: query<HTMLButtonElement>("#kinHermesSaveButton"),
  voiceEnabledInput: query<HTMLInputElement>("#voiceEnabledInput"),
  filterNarrationInput: query<HTMLInputElement>("#filterNarrationInput"),
  voiceProviderInput: query<HTMLSelectElement>("#voiceProviderInput"),
  openAiVoiceLabel: query<HTMLElement>("#openAiVoiceLabel"),
  openAiVoiceInput: query<HTMLSelectElement>("#openAiVoiceInput"),
  elevenLabsVoiceLabel: query<HTMLElement>("#elevenLabsVoiceLabel"),
  elevenLabsVoiceInput: query<HTMLInputElement>("#elevenLabsVoiceInput"),
  narrationDelimiterInput: query<HTMLInputElement>("#narrationDelimiterInput"),
  openAiInstructionsInput: query<HTMLTextAreaElement>("#openAiInstructionsInput"),
  voiceStatusLine: query<HTMLElement>("#voiceStatusLine"),
  voiceSaveButton: query<HTMLButtonElement>("#voiceSaveButton"),
  soundscapeEnabledInput: query<HTMLInputElement>("#soundscapeEnabledInput"),
  soundscapeStatusLine: query<HTMLElement>("#soundscapeStatusLine"),
  soundscapeLayerList: query<HTMLElement>("#soundscapeLayerList"),
  soundscapeForcePrewarmButton: query<HTMLButtonElement>("#soundscapeForcePrewarmButton"),
  timelineList: query<HTMLElement>("#timelineList"),
  timeline: query<HTMLElement>(".timeline"),
  monitorLine: query<HTMLElement>("#monitorLine"),
  messageList: query<HTMLElement>("#messageList"),
  loginStartButton: query<HTMLButtonElement>("#loginStartButton"),
  loginSaveButton: query<HTMLButtonElement>("#loginSaveButton"),
  openKindroidButton: query<HTMLButtonElement>("#openKindroidButton"),
  toggleKinsButton: query<HTMLButtonElement>("#toggleKinsButton"),
  refreshKinsButton: query<HTMLButtonElement>("#refreshKinsButton"),
  toggleGroupsButton: query<HTMLButtonElement>("#toggleGroupsButton"),
  refreshGroupsButton: query<HTMLButtonElement>("#refreshGroupsButton"),
  clearButton: query<HTMLButtonElement>("#clearButton")
};

const soundscapeController = new SoundscapeController({
  async loadSample(relativePath: string) {
    return bytesToArrayBuffer(await window.kinagent.readSoundscapeAsset({ path: relativePath }));
  },
  onCue(label: string) {
    if (!state.activeSoundscapeKey) {
      return;
    }
    state.lastSoundscapeCue = {
      key: state.activeSoundscapeKey,
      label,
      expiresAt: Date.now() + 12_000
    };
    renderSoundscapeStatus();
    window.setTimeout(renderSoundscapeStatus, 12_200);
  },
  onStatus(message: string) {
    if (state.activeTab === "voice") {
      elements.monitorLine.textContent = message;
    }
  }
});

const playVoiceAudio = createVoiceAudioPlayer({
  onError(error: unknown) {
    elements.monitorLine.textContent = `Voice playback failed: ${errorMessage(error)}`;
  },
  onPlaybackScheduled(durationMs: number) {
    soundscapeController.duckFor(durationMs + 300);
  }
});

function capturedDetailContext() {
  return {
    state,
    elements,
    onSelectHistoryEntry: (hash: string | null) => {
      state.selectedHistoryHash = hash;
      renderActivity();
    }
  };
}

function appSettingsContext() {
  return {
    state,
    elements,
    api: window.kinagent,
    renderActivity,
    renderDetailEmpty,
    loadAppSettings
  };
}

function browserIntegrationContext() {
  return {
    state,
    elements,
    api: window.kinagent,
    renderActivity,
    renderDetailEmpty,
    loadBrowserIntegration
  };
}

function renderDetailEmpty(message: string): void {
  renderCapturedDetailEmpty(capturedDetailContext(), message);
}

function voiceHermesContext() {
  return {
    state,
    elements,
    api: window.kinagent,
    renderActivity,
    renderDetailEmpty,
    chatDynamismSlider,
    onSoundscapePreferenceChanged: (kinId: string, preference: { enabled: boolean }) => {
      state.subscriptions = state.subscriptions.map((subscription) =>
        subscription.kin?.aiId === kinId ? { ...subscription, soundscape: preference } : subscription
      );
      if (!preference.enabled && state.activeSoundscapeKey === `kin:${kinId}`) {
        delete state.soundscapeUpdates[`kin:${kinId}`];
      }
      void applyActiveSoundscape();
      renderSoundscapeStatus();
    },
    renderSoundscapeLayers: (container: HTMLElement, kinId: string) => {
      renderSoundscapeLayerList(container, state.soundscapeUpdates[`kin:${kinId}`]?.state);
    }
  };
}

function subscriptionListContext() {
  return {
    state,
    elements,
    loginOnboardingMessage,
    refreshErrorLine,
    onSelectKin: (kinId: string) => {
      void selectKin(kinId);
    },
    onSelectGroup: selectGroup,
    onSetKinEnabled: (kinId: string, enabled: boolean) => {
      void runAction(enabled ? "Enabling Kin" : "Disabling Kin", async () => {
        await window.kinagent.setKinEnabled({ kinId, enabled });
        await refreshStatus();
      });
    },
    onSetGroupEnabled: (groupId: string, enabled: boolean) => {
      void runAction(enabled ? "Enabling group" : "Disabling group", async () => {
        await window.kinagent.setGroupEnabled({ groupId, enabled });
        await refreshStatus();
      });
    }
  };
}

function journalSuggestionsContext() {
  return {
    state,
    elements,
    onAcceptSuggestion: (id: string) => {
      void acceptJournalSuggestion(id);
    },
    onDeleteInvalidatedSuggestion: (id: string) => {
      void deleteInvalidatedJournalSuggestion(id);
    },
    onDismissSuggestion: (id: string) => {
      void dismissJournalSuggestion(id);
    }
  };
}

function groupBackgroundPanelContext() {
  return {
    state,
    elements,
    onSavePreference: (preference: GroupBackgroundPreference) => {
      void saveSelectedGroupBackground(preference);
    },
    onForcePrewarm: () => {
      void forceSelectedGroupBackgroundPrewarm();
    },
    onGenerateImage: (id: string) => {
      void generateGroupBackgroundImage(id);
    },
    onApplyImage: (id: string) => {
      void applyGroupBackgroundImage(id);
    },
    onDismissSuggestion: (id: string) => {
      void dismissGroupBackgroundSuggestion(id);
    }
  };
}

function tabNavigationContext() {
  return {
    state,
    elements,
    loadAppSettings: () => {
      void loadAppSettings();
    },
    loadBrowserIntegration: () => {
      void loadBrowserIntegration();
    },
    loadKinVoice: (kinId: string) => {
      void loadKinVoice(kinId);
    },
    loadKinAmbient: (kinId: string) => {
      void loadKinAmbient(kinId);
    },
    renderActivity
  };
}

function actionPanelContext() {
  return {
    state,
    elements
  };
}

function monitorPanelContext() {
  return {
    state,
    elements,
    selectedKin: currentSelectedKin(),
    selectedGroup: currentSelectedGroup(),
    maxMonitorMessages
  };
}

elements.loginStartButton.addEventListener("click", () => {
  void runAction("Opening login", () => window.kinagent.startLogin());
});
elements.loginSaveButton.addEventListener(
  "click",
  () =>
    void runAction("Saving session", async () => {
      await window.kinagent.saveLogin();
      await refreshStatus();
    })
);
elements.openKindroidButton.addEventListener("click", () => {
  void runAction("Opening Kindroid", () => window.kinagent.openKindroid());
});
elements.toggleKinsButton.addEventListener("click", () => {
  state.kinsExpanded = !state.kinsExpanded;
  renderKinSubscriptions(subscriptionListContext());
});
elements.refreshKinsButton.addEventListener(
  "click",
  () =>
    void runAction("Refreshing Kins", async () => {
      await window.kinagent.refreshKins();
      await refreshStatus();
    })
);
elements.toggleGroupsButton.addEventListener("click", () => {
  state.groupsExpanded = !state.groupsExpanded;
  renderGroupSubscriptions(subscriptionListContext());
});
elements.refreshGroupsButton.addEventListener(
  "click",
  () =>
    void runAction("Refreshing groups", async () => {
      await window.kinagent.refreshGroups();
      await refreshStatus();
    })
);
elements.clearButton.addEventListener("click", () => {
  clearVisibleMonitorMessages(monitorPanelContext());
});
elements.detailTabs.addEventListener("click", (event) => {
  handleDetailTabsClick(tabNavigationContext(), event);
});
elements.kinDetailTabs.addEventListener("click", (event) => {
  handleKinDetailTabsClick(tabNavigationContext(), event);
});
elements.groupDetailTabs.addEventListener("click", (event) => {
  handleKinDetailTabsClick(tabNavigationContext(), event);
});
elements.settingTabs.addEventListener("click", (event) => {
  handleSettingTabsClick(tabNavigationContext(), event);
});
elements.groupSettingTabs.addEventListener("click", (event) => {
  handleGroupSettingTabsClick(tabNavigationContext(), event);
});
elements.voiceProviderInput.addEventListener("change", () => {
  renderVoiceProviderFields(voiceHermesContext());
});
elements.appSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveAppSettings(appSettingsContext());
});
elements.browserIntegrationPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveBrowserIntegration(browserIntegrationContext());
});
elements.browserIntegrationRegisterButton.addEventListener("click", () => {
  void registerBrowserIntegration(browserIntegrationContext());
});
elements.browserIntegrationUnregisterButton.addEventListener("click", () => {
  void unregisterBrowserIntegration(browserIntegrationContext());
});
elements.browserIntegrationNoticeButton.addEventListener("click", () => {
  void runBrowserIntegrationTest("Sending browser notice", () => window.kinagent.testBrowserIntegrationNotice());
});
elements.browserIntegrationReloadButton.addEventListener("click", () => {
  void runBrowserIntegrationTest("Queuing Kindroid reload", () => window.kinagent.testBrowserIntegrationReload());
});
elements.voiceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinVoice(voiceHermesContext());
});
elements.soundscapeEnabledInput.addEventListener("change", () => {
  soundscapeController.markUserInteractionReady();
});
elements.groupSoundscapeEnabledInput.addEventListener("change", () => {
  soundscapeController.markUserInteractionReady();
});
elements.groupSoundscapeSaveButton.addEventListener("click", () => {
  void saveSelectedGroupSoundscape();
});
elements.groupGamingCampaignInput.addEventListener("change", () => {
  const selectedCampaign = selectedCampaignFor(
    elements.groupGamingCampaignInput.value,
    state.selectedGroupGaming?.campaigns || []
  );
  renderMysteryOptions(selectedCampaign, selectedCampaign?.mysteries[0]?.id);
  renderCampaignSummary(selectedCampaign, selectedCampaign?.mysteries[0]);
});
elements.groupGamingMysteryInput.addEventListener("change", () => {
  const selectedCampaign = selectedCampaignFor(
    elements.groupGamingCampaignInput.value,
    state.selectedGroupGaming?.campaigns || []
  );
  renderCampaignSummary(selectedCampaign, selectedMysteryFor(elements.groupGamingMysteryInput.value, selectedCampaign));
});
elements.groupGamingSaveButton.addEventListener("click", () => {
  void saveSelectedGroupGaming();
});
elements.groupGamingApproveButton.addEventListener("click", () => {
  void approveGroupGamingKeeperSuggestion();
});
elements.groupGamingImportButton.addEventListener("click", () => {
  void importGroupCampaignPack();
});
elements.soundscapeForcePrewarmButton.addEventListener("click", () => {
  void forceSelectedSoundscapePrewarm("kin");
});
elements.groupSoundscapeForcePrewarmButton.addEventListener("click", () => {
  void forceSelectedSoundscapePrewarm("group");
});
elements.kinHermesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinAmbient(voiceHermesContext());
});
elements.chatDynamismMinInput.addEventListener("input", () => {
  syncChatDynamismRangeLabels(voiceHermesContext());
});
elements.chatDynamismMaxInput.addEventListener("input", () => {
  syncChatDynamismRangeLabels(voiceHermesContext());
});
elements.kinAnalyzeButton.addEventListener("click", () => {
  void analyzeSelectedKin({ state, elements, api: window.kinagent, renderActivity });
});
elements.chatExportRangeButton.addEventListener("click", () => {
  void exportSelectedChat({ state, elements, api: window.kinagent, renderActivity }, false);
});
elements.chatExportAllButton.addEventListener("click", () => {
  void exportSelectedChat({ state, elements, api: window.kinagent, renderActivity }, true);
});
document.addEventListener(
  "pointerdown",
  () => {
    soundscapeController.markUserInteractionReady();
  },
  { once: true }
);
document.addEventListener(
  "keydown",
  () => {
    soundscapeController.markUserInteractionReady();
  },
  { once: true }
);

window.kinagent.onEvent((message) => {
  if (message.channel === "runtime-startup-error") {
    elements.sessionLine.textContent = message.payload?.error || "Runtime startup failed";
    elements.monitorLine.textContent = "Runtime startup failed";
    return;
  }

  if (message.channel === "monitor-line") {
    const payload = message.payload as MonitorMessage & { message?: string; line?: string };
    activateSoundscapeFromPayload(payload);
    handleMonitorLine(monitorPanelContext(), payload);
    return;
  }

  if (message.channel === "voice-audio") {
    void playVoiceAudio(message.payload as VoiceAudioPayload | undefined);
    return;
  }

  if (message.channel === "journal-suggestion-created") {
    const suggestion = message.payload as JournalSuggestionSummary | undefined;
    upsertJournalSuggestion(state, suggestion);
    elements.monitorLine.textContent = journalSuggestionNotice(state, suggestion);
    renderActivity();
    return;
  }

  if (message.channel === "group-background-suggestion-created") {
    const suggestion = message.payload as GroupBackgroundSuggestionSummary | undefined;
    upsertGroupBackgroundSuggestion(state, suggestion);
    elements.monitorLine.textContent = groupBackgroundSuggestionNotice(state, suggestion);
    renderActivity();
    return;
  }

  if (message.channel === "soundscape-updated") {
    handleSoundscapeUpdate(message.payload as ScopedSoundscapeUpdate | undefined);
    return;
  }

  if (message.channel === "local-scene-updated") {
    upsertLocalScene(message.payload as LocalSceneStateSummary | undefined);
    renderActivity();
    return;
  }

  if (message.channel === "previously-on-updated") {
    upsertPreviouslyOnBrief(message.payload as PreviouslyOnBriefSummary | undefined);
    renderActivity();
    return;
  }

  if (message.channel === "game-campaign-state-updated") {
    upsertGroupCampaignState(message.payload as GroupCampaignStateSummary | undefined);
    renderActivity();
    return;
  }

  if (message.channel === "prewarm-state-updated") {
    upsertPrewarmState(message.payload as PrewarmSourceSummary | undefined);
    renderActivity();
    return;
  }

  if (message.channel === "journal-suggestions-updated") {
    state.journalSuggestions = Array.isArray(message.payload) ? (message.payload as JournalSuggestionSummary[]) : [];
    renderActivity();
    return;
  }

  if (message.channel === "group-background-suggestions-updated") {
    state.groupBackgroundSuggestions = Array.isArray(message.payload)
      ? (message.payload as GroupBackgroundSuggestionSummary[])
      : [];
    renderActivity();
    return;
  }

  if (message.channel === "journal-suggestion-focus") {
    void focusJournalSuggestion(message.payload as JournalSuggestionSummary | undefined);
    return;
  }

  if (message.channel === "chat-export-progress") {
    renderChatExportProgress({ state, elements }, message.payload as ChatExportProgress | undefined);
    return;
  }

  if (message.channel === "kin-analysis-progress") {
    renderKinAnalysisProgress({ state, elements }, message.payload as KinAnalysisProgress | undefined);
    return;
  }

  if (message.channel === "monitor-started") {
    activateSoundscapeFromPayload(message.payload);
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, true);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "monitor-stopped" || message.channel === "monitor-exit") {
    deactivateSoundscapeFromPayload(message.payload);
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, false);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "monitor-error") {
    deactivateSoundscapeFromPayload(message.payload);
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, false);
    updateMonitorRunning();
    elements.monitorLine.textContent = payloadText(message.payload, "Monitor error");
    return;
  }

  if (message.channel === "group-monitor-started") {
    activateSoundscapeFromPayload(message.payload);
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, true);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "group-monitor-stopped" || message.channel === "group-monitor-exit") {
    deactivateSoundscapeFromPayload(message.payload);
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, false);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "group-monitor-error") {
    deactivateSoundscapeFromPayload(message.payload);
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, false);
    updateMonitorRunning();
    elements.monitorLine.textContent = payloadText(message.payload, "Group monitor error");
    return;
  }

  if (message.channel === "session-updated") {
    renderStatus((message.payload as DesktopStatus | undefined) || {});
    return;
  }

  if (message.channel === "session-keepalive") {
    const payload = message.payload;
    elements.sessionLine.textContent = payload?.ok
      ? payload.warmed
        ? "Session warmed"
        : "Session refreshed"
      : "Session refresh failed";
    return;
  }

  if (message.channel === "kins-updated") {
    state.subscriptions = Array.isArray(message.payload) ? (message.payload as KinSubscriptionSummary[]) : [];
    state.kins = state.subscriptions.flatMap((subscription) => (subscription.kin ? [subscription.kin] : []));
    clearMissingSelectedKin();
    updateMonitorRunning();
    renderKinSubscriptions(subscriptionListContext());
    renderMonitorState(monitorPanelContext());
    renderActivity();
    return;
  }

  if (message.channel === "groups-updated") {
    state.groupSubscriptions = Array.isArray(message.payload) ? (message.payload as GroupSubscriptionSummary[]) : [];
    state.groups = state.groupSubscriptions.flatMap((subscription) => (subscription.group ? [subscription.group] : []));
    clearMissingSelectedGroup();
    updateMonitorRunning();
    renderGroupSubscriptions(subscriptionListContext());
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "kins-refresh-error") {
    elements.kinRefreshLine.textContent = refreshErrorLine(String(message.payload || ""), "Kin refresh failed");
    return;
  }

  if (message.channel === "groups-refresh-error") {
    elements.groupRefreshLine.textContent = refreshErrorLine(String(message.payload || ""), "Group refresh failed");
  }
});

refreshStatus().catch((error: unknown) => {
  elements.sessionLine.textContent = errorMessage(error);
});

async function refreshStatus(): Promise<void> {
  const status = await window.kinagent.getStatus();
  renderStatus(status);
}

function renderStatus(status: DesktopStatus): void {
  state.kins = status.kins || [];
  state.subscriptions = status.subscriptions || [];
  state.groups = status.groups || [];
  state.groupSubscriptions = status.groupSubscriptions || [];
  state.journalSuggestions = status.journalSuggestions || [];
  state.groupBackgroundSuggestions = status.groupBackgroundSuggestions || [];
  state.localScenes = status.localScenes || [];
  state.sceneLedgers = status.sceneLedgers || [];
  state.previouslyOnBriefs = status.previouslyOn || [];
  state.prewarmStates = status.prewarmStates || [];
  state.soundscapeUpdates = soundscapeUpdatesFromList(status.soundscapes || []);
  state.monitorRunning = Boolean(status.monitorRunning);
  state.sessionAvailable = Boolean(status.session?.available);
  state.kinRefresh = status.kinRefresh || null;
  state.groupRefresh = status.groupRefresh || null;

  const session = status.session || {};
  elements.sessionLine.textContent = session.available ? "Session saved" : "No saved session";
  elements.firebaseStatus.textContent = session.hasFirebaseAuth ? "Ready" : "Missing";
  elements.appCheckStatus.textContent = status.appCheckPresent ? "Ready" : "Missing";
  elements.expiryStatus.textContent = session.expirationIso || "Unknown";

  clearMissingSelectedKin();
  clearMissingSelectedGroup();
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
  renderMonitorState(monitorPanelContext());
  renderActivity();
}

function refreshErrorLine(error: string | undefined, fallback: string): string {
  if (!state.sessionAvailable || isMissingSessionError(error)) {
    return loginOnboardingMessage;
  }

  return error || fallback;
}

function isMissingSessionError(error: string | undefined): boolean {
  return typeof error === "string" && error.includes("No Kindroid browser session found");
}

async function selectKin(kinId: string): Promise<void> {
  if (!kinId) {
    return;
  }

  state.selectedKinId = kinId;
  state.selectedGroupId = null;
  state.activeTab = isKinTab(state.activeTab) ? state.activeTab : "backstory";
  state.selectedHistoryHash = null;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedGroupCapture = null;
  state.selectedKinVoice = null;
  state.selectedGroupSoundscape = null;
  state.selectedGroupGaming = null;
  state.selectedGroupBackground = null;
  state.selectedKinAmbient = null;
  state.journalError = null;
  state.voiceError = null;
  state.ambientError = null;
  resetKinActionPlaceholders();
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
  renderActivity();
  void loadKinVoice(kinId);
  void loadKinAmbient(kinId);

  try {
    state.selectedKinCapture = await withTimeout(
      window.kinagent.getCapturedKin({ kinId }),
      captureRequestTimeoutMs,
      "Captured settings request timed out."
    );
  } catch (error) {
    state.captureError = errorMessage(error);
  } finally {
    state.captureLoading = false;
    renderActivity();
  }
}

function selectGroup(groupId: string): void {
  if (!groupId) {
    return;
  }

  state.selectedGroupId = groupId;
  state.selectedKinId = null;
  state.activeTab = isGroupTab(state.activeTab) ? state.activeTab : "group-context";
  state.selectedHistoryHash = null;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedGroupCapture = null;
  state.selectedKinVoice = null;
  state.selectedGroupSoundscape = null;
  state.selectedGroupGaming = null;
  state.selectedKinAmbient = null;
  state.voiceError = null;
  state.groupSoundscapeError = null;
  state.groupBackgroundError = null;
  state.groupGamingError = null;
  state.ambientError = null;
  state.voiceLoading = false;
  state.groupSoundscapeLoading = false;
  state.groupBackgroundLoading = false;
  state.groupGamingLoading = false;
  state.ambientLoading = false;
  resetKinActionPlaceholders();
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
  renderMonitorState(monitorPanelContext());
  renderActivity();
  void loadGroupSoundscape(groupId);
  void loadGroupGaming(groupId);
  void loadGroupBackground(groupId);

  void (async () => {
    try {
      state.selectedGroupCapture = await withTimeout(
        window.kinagent.getCapturedGroup({ groupId }),
        captureRequestTimeoutMs,
        "Captured settings request timed out."
      );
    } catch (error) {
      state.captureError = errorMessage(error);
    } finally {
      state.captureLoading = false;
      renderActivity();
    }
  })();
}

async function loadKinVoice(kinId: string): Promise<void> {
  state.voiceLoading = true;
  state.voiceError = null;
  renderActivity();

  try {
    state.selectedKinVoice = await window.kinagent.getKinVoicePreference({ kinId });
  } catch (error) {
    state.voiceError = errorMessage(error);
  } finally {
    state.voiceLoading = false;
    renderActivity();
  }
}

async function loadGroupSoundscape(groupId: string): Promise<void> {
  state.groupSoundscapeLoading = true;
  state.groupSoundscapeError = null;
  renderActivity();

  try {
    state.selectedGroupSoundscape = await window.kinagent.getGroupSoundscapePreference({ groupId });
  } catch (error) {
    state.groupSoundscapeError = errorMessage(error);
  } finally {
    state.groupSoundscapeLoading = false;
    renderActivity();
  }
}

async function loadGroupGaming(groupId: string): Promise<void> {
  state.groupGamingLoading = true;
  state.groupGamingError = null;
  renderActivity();

  try {
    state.selectedGroupGaming = await window.kinagent.getGroupGamingPreference({ groupId });
  } catch (error) {
    state.groupGamingError = errorMessage(error);
  } finally {
    state.groupGamingLoading = false;
    renderActivity();
  }
}

async function loadGroupBackground(groupId: string): Promise<void> {
  state.groupBackgroundLoading = true;
  state.groupBackgroundError = null;
  renderActivity();

  try {
    state.selectedGroupBackground = await window.kinagent.getGroupBackgroundPreference({ groupId });
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
  } finally {
    state.groupBackgroundLoading = false;
    renderActivity();
  }
}

async function loadKinAmbient(kinId: string): Promise<void> {
  state.ambientLoading = true;
  state.ambientError = null;
  renderActivity();

  try {
    state.selectedKinAmbient = await window.kinagent.getKinAmbientPreference({ kinId });
  } catch (error) {
    state.ambientError = errorMessage(error);
  } finally {
    state.ambientLoading = false;
    renderActivity();
  }
}

async function loadAppSettings(): Promise<void> {
  state.appSettingsLoading = true;
  state.appSettingsError = null;
  renderActivity();

  try {
    state.appSettings = await window.kinagent.getSettings();
  } catch (error) {
    state.appSettingsError = errorMessage(error);
  } finally {
    state.appSettingsLoading = false;
    renderActivity();
  }
}

async function loadBrowserIntegration(): Promise<void> {
  state.browserIntegrationLoading = true;
  state.browserIntegrationError = null;
  renderActivity();

  try {
    state.browserIntegration = await window.kinagent.getBrowserIntegrationStatus();
  } catch (error) {
    state.browserIntegrationError = errorMessage(error);
  } finally {
    state.browserIntegrationLoading = false;
    renderActivity();
  }
}

async function runBrowserIntegrationTest(
  statusText: string,
  action: () => Promise<BrowserIntegrationStatus>
): Promise<void> {
  state.browserIntegrationSaving = true;
  state.browserIntegrationError = null;
  elements.browserIntegrationStatusLine.textContent = statusText;

  try {
    state.browserIntegration = await action();
    elements.monitorLine.textContent = statusText;
  } catch (error) {
    state.browserIntegrationError = errorMessage(error);
  } finally {
    state.browserIntegrationSaving = false;
    renderActivity();
  }
}

function renderActivity(): void {
  elements.previouslyOnPanel.hidden = true;
  elements.previouslyOnPanel.replaceChildren();
  elements.directorPanel.hidden = true;
  elements.directorPanel.replaceChildren();
  elements.localSceneActions.hidden = true;
  elements.localSceneActions.replaceChildren();
  elements.browserIntegrationPanel.hidden = true;
  elements.groupBackgroundPanel.hidden = true;
  const activeTab = state.activeTab || "monitor";
  const activeMode = modeForTab(activeTab);
  const isMonitor = activeMode === "monitor";
  const isVoice = activeMode === "voice";
  const isLocalScene = activeMode === "local-scene";
  const isGroupLocalScene = activeMode === "group-local-scene";
  const isGroupBackground = activeMode === "group-background";
  const isGroupAudio = activeMode === "group-audio";
  const isGroupGaming = activeMode === "group-gaming";
  const isHermes = activeMode === "hermes";
  const isAnalyze = activeMode === "analyze";
  const isExport = activeMode === "export";
  const isAppSettings = activeMode === "app-settings";
  const isBrowserIntegration = activeMode === "browser-integration";

  renderJournalTabBadge(journalSuggestionsContext());
  renderTabNavigation(tabNavigationContext(), activeMode);

  if (isMonitor) {
    const selectedKin = currentSelectedKin();
    const selectedGroup = currentSelectedGroup();
    elements.activityTitle.textContent = selectedGroup
      ? `${selectedGroup.name || "Group"} · Monitor`
      : selectedKin
        ? `${selectedKin.name || "Kin"} · Monitor`
        : "Incoming Messages";
    renderMessageList(monitorPanelContext());
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (isAppSettings) {
    elements.activityTitle.textContent = "Settings";
    elements.monitorLine.textContent = "Application configuration";
    renderAppSettingsTab(appSettingsContext());
    return;
  }

  if (isBrowserIntegration) {
    elements.activityTitle.textContent = "Browser";
    elements.monitorLine.textContent = "Browser extension integration";
    renderBrowserIntegrationTab(browserIntegrationContext());
    return;
  }

  const selectedGroup = currentSelectedGroup();
  if (selectedGroup && isGroupLocalScene) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Scene`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderLocalSceneTab("group", selectedGroup);
    return;
  }

  if (selectedGroup && isGroupBackground) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Background`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupBackgroundTab(selectedGroup);
    return;
  }

  if (selectedGroup && isGroupAudio) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Audio`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupAudioTab(selectedGroup);
    return;
  }

  if (selectedGroup && isGroupGaming) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Gaming`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupGamingTab(selectedGroup);
    return;
  }

  if (selectedGroup && activeMode === "group-export") {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Export`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupExportTab(actionPanelContext(), selectedGroup);
    return;
  }

  const selectedKin = currentSelectedKin();
  const field = currentCapturedField();
  const tabLabel = field?.label || tabLabelFor(tabNavigationContext(), activeTab);
  elements.activityTitle.textContent = selectedGroup
    ? `${selectedGroup.name || "Group"} · ${tabLabel}`
    : selectedKin
      ? `${selectedKin.name || "Kin"} · ${tabLabel}`
      : tabLabel;
  elements.monitorLine.textContent = subtitleForDetailMode(activeMode);

  if (selectedGroup) {
    renderGroupCapturedTab(selectedGroup, field);
    return;
  }

  if (!state.selectedKinId) {
    renderDetailEmpty("Select Manage on a Kin or Group to inspect captured settings.");
    return;
  }

  if (isVoice) {
    renderVoiceTab(voiceHermesContext(), selectedKin);
    return;
  }

  if (isLocalScene) {
    renderLocalSceneTab("kin", selectedKin);
    return;
  }

  if (isHermes) {
    renderKinHermesTab(voiceHermesContext(), selectedKin);
    return;
  }

  if (isAnalyze) {
    renderKinAnalyzeTab(actionPanelContext(), selectedKin);
    return;
  }

  if (isExport) {
    renderKinExportTab(actionPanelContext(), selectedKin);
    return;
  }

  if (state.captureLoading) {
    renderDetailEmpty("Loading captured settings.");
    return;
  }

  if (state.captureError) {
    renderDetailEmpty(state.captureError);
    return;
  }

  if (!state.selectedKinCapture?.ok) {
    renderDetailEmpty(state.selectedKinCapture?.error || "No captured state found for this Kin yet.");
    return;
  }

  if (!field || !field.available) {
    renderCapturedDetailContent(capturedDetailContext(), {
      content: "No captured value for this setting.",
      history: [],
      stats: capturedDetailStats({
        selectedKin,
        field,
        capture: state.selectedKinCapture,
        fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
      })
    });
    renderJournalSuggestions(journalSuggestionsContext());
    return;
  }

  renderCapturedDetailContent(capturedDetailContext(), {
    content: field.content || "",
    history: field.history || [],
    stats: capturedDetailStats({
      selectedKin,
      field,
      capture: state.selectedKinCapture,
      fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
    })
  });
  renderJournalSuggestions(journalSuggestionsContext());
}

function renderGroupCapturedTab(selectedGroup: GroupSummary, field: CapturedFieldSummary | null): void {
  if (!state.selectedGroupId) {
    renderDetailEmpty("Select Manage on a Group to inspect captured settings.");
    return;
  }

  if (state.captureLoading) {
    renderDetailEmpty("Loading captured settings.");
    return;
  }

  if (state.captureError) {
    renderDetailEmpty(state.captureError);
    return;
  }

  if (!state.selectedGroupCapture?.ok) {
    renderDetailEmpty(state.selectedGroupCapture?.error || "No captured state found for this Group yet.");
    return;
  }

  if (!field || !field.available) {
    renderCapturedDetailContent(capturedDetailContext(), {
      content: "No captured value for this setting.",
      history: [],
      stats: capturedDetailStats({
        selectedGroup,
        groupId: state.selectedGroupId,
        field,
        capture: state.selectedGroupCapture,
        fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
      })
    });
    return;
  }

  renderCapturedDetailContent(capturedDetailContext(), {
    content: field.content || "",
    history: field.history || [],
    stats: capturedDetailStats({
      selectedGroup,
      groupId: state.selectedGroupId,
      field,
      capture: state.selectedGroupCapture,
      fallbackSettingLabel: tabLabelFor(tabNavigationContext(), state.activeTab)
    })
  });
}

function renderGroupBackgroundTab(selectedGroup: GroupSummary): void {
  if (state.groupBackgroundLoading) {
    renderDetailEmpty("Loading group background settings.");
    return;
  }

  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.groupBackgroundPanel.hidden = false;
  elements.groupGamingPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;

  renderGroupBackgroundPanel(groupBackgroundPanelContext(), selectedGroup);
  renderDetailStats([
    { label: "Group", value: selectedGroup.name || state.selectedGroupId || "Unknown" },
    {
      label: "Pending",
      value: String(
        state.groupBackgroundSuggestions.filter((suggestion) => suggestion.groupId === state.selectedGroupId).length
      )
    },
    { label: "Mode", value: "Review" }
  ]);
}

function renderGroupAudioTab(selectedGroup: GroupSummary): void {
  if (state.groupSoundscapeLoading) {
    renderDetailEmpty("Loading group audio settings.");
    return;
  }

  if (state.groupSoundscapeError) {
    renderDetailEmpty(state.groupSoundscapeError);
    return;
  }

  const preference = state.selectedGroupSoundscape?.soundscape || { enabled: false };
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = false;
  elements.groupBackgroundPanel.hidden = true;
  elements.groupGamingPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;

  elements.groupSoundscapeEnabledInput.checked = Boolean(preference.enabled);
  elements.groupSoundscapeSaveButton.disabled = state.groupSoundscapeSaving;
  elements.groupSoundscapeForcePrewarmButton.disabled = state.groupSoundscapeForceSaving || !preference.enabled;
  elements.groupSoundscapeStatusLine.textContent = preference.enabled
    ? "Hermes soundscape is enabled for this Group."
    : "Hermes soundscape is disabled for this Group.";
  const key = `group:${state.selectedGroupId ?? ""}`;
  renderSoundscapeLayerList(
    elements.groupSoundscapeLayerList,
    state.soundscapeUpdates[key]?.state,
    activeCueLabel(key)
  );
  renderDetailStats([
    { label: "Group", value: selectedGroup.name || state.selectedGroupId || "Unknown" },
    { label: "Soundscape", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Scope", value: "Group" },
    { label: "Mode", value: "Local" }
  ]);
}

function renderGroupGamingTab(selectedGroup: GroupSummary): void {
  if (state.groupGamingLoading) {
    renderDetailEmpty("Loading Gaming settings.");
    return;
  }

  if (state.groupGamingError) {
    renderDetailEmpty(state.groupGamingError);
    return;
  }

  const preference = state.selectedGroupGaming?.preference || {
    enabled: false,
    automationMode: "observe"
  };
  const campaigns = state.selectedGroupGaming?.campaigns || [];
  const selectedCampaign = selectedCampaignFor(preference.campaignId, campaigns);
  const selectedMystery = selectedMysteryFor(preference.mysteryId, selectedCampaign);

  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "scene-detail-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.groupBackgroundPanel.hidden = true;
  elements.groupGamingPanel.hidden = false;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;

  renderCampaignOptions(campaigns, selectedCampaign?.id);
  renderMysteryOptions(selectedCampaign, selectedMystery?.id);
  elements.groupGamingEnabledInput.checked = Boolean(preference.enabled);
  elements.groupGamingAutomationInput.value = preference.automationMode || "observe";
  elements.groupGamingSaveButton.disabled = state.groupGamingSaving || campaigns.length === 0;
  elements.groupGamingApproveButton.disabled =
    state.groupGamingApproving || !state.selectedGroupGaming?.activeState?.pendingDecision?.keeperMessage;
  elements.groupGamingImportButton.disabled = state.groupGamingImporting;
  const activeState = state.selectedGroupGaming?.activeState;
  elements.groupGamingStatusLine.textContent = !preference.enabled
    ? "Gaming is disabled for this Group."
    : activeState?.status === "completed"
      ? "Mystery is complete. Use /reset-mystery to restart local progress or select a different mystery."
      : "Gaming is enabled for this Group. State changes stay local; Suggest waits for approval before sending Keeper messages.";
  renderCampaignSummary(selectedCampaign, selectedMystery);
  renderGroupGamingState(selectedMystery);
  renderDetailStats([
    { label: "Group", value: selectedGroup.name || state.selectedGroupId || "Unknown" },
    { label: "Gaming", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Automation", value: automationModeLabel(preference.automationMode) }
  ]);
}

function renderCampaignOptions(campaigns: CampaignPackSummary[], selectedCampaignId: string | undefined): void {
  elements.groupGamingCampaignInput.replaceChildren();
  for (const campaign of campaigns) {
    const option = document.createElement("option");
    option.value = campaign.id;
    option.textContent = campaign.title;
    option.selected = campaign.id === selectedCampaignId;
    elements.groupGamingCampaignInput.append(option);
  }
}

function renderMysteryOptions(campaign: CampaignPackSummary | undefined, selectedMysteryId: string | undefined): void {
  elements.groupGamingMysteryInput.replaceChildren();
  for (const mystery of campaign?.mysteries ?? []) {
    const option = document.createElement("option");
    option.value = mystery.id;
    option.textContent = mystery.title;
    option.selected = mystery.id === selectedMysteryId;
    elements.groupGamingMysteryInput.append(option);
  }
}

function renderCampaignSummary(
  campaign: CampaignPackSummary | undefined,
  mystery: CampaignPackSummary["mysteries"][number] | undefined
): void {
  elements.groupGamingCampaignSummary.replaceChildren();
  const rows = campaign
    ? [
        { label: "Campaign", value: campaign.title },
        { label: "Mystery", value: mystery?.title || "First mystery" },
        { label: "Ruleset", value: campaign.rulesetStyle },
        { label: "Threats", value: String(mystery?.threatCount ?? campaign.threatCount) },
        { label: "License", value: campaign.license },
        { label: "Warnings", value: (campaign.contentWarnings || []).join(", ") || "None listed" }
      ]
    : [{ label: "Campaign", value: "No campaign packs found" }];

  for (const row of rows) {
    const wrapper = document.createElement("div");
    const label = document.createElement("dt");
    const value = document.createElement("dd");
    label.textContent = row.label;
    value.textContent = row.value;
    wrapper.append(label, value);
    elements.groupGamingCampaignSummary.append(wrapper);
  }
}

function renderGroupGamingState(mystery: CampaignPackSummary["mysteries"][number] | undefined): void {
  elements.groupGamingStateList.replaceChildren();
  const campaignState = state.selectedGroupGaming?.activeState;
  if (!campaignState) {
    elements.groupGamingStateList.append(gamingStatePill("No active state"));
    return;
  }

  const latestNote = campaignState.notes.at(-1);
  elements.groupGamingStateList.append(
    gamingStatePill(`State: ${statusLabel(campaignState.status)}`),
    gamingStatePill(`Countdown: ${countWithTotal(campaignState.currentCountdownIndex, mystery?.countdownStages)}`),
    gamingStatePill(`Clues: ${countWithTotal(campaignState.discoveredClueIds.length, mystery?.clueCount)}`),
    gamingStatePill(`Threats: ${countWithTotal(campaignState.revealedThreatIds?.length ?? 0, mystery?.threatCount)}`),
    gamingStatePill(`NPCs: ${campaignState.revealedNpcIds.length}`),
    gamingStatePill(`Locations: ${campaignState.visitedLocationIds.length}`),
    gamingStatePill(campaignState.pendingDecision ? "Keeper: Pending" : "Keeper: Clear"),
    gamingStatePill(campaignState.pendingRollRequest ? "Roll: Pending" : "Roll: Clear")
  );
  if (campaignState.status === "completed") {
    elements.groupGamingStateList.append(gamingStatePill("Ending: Complete"));
  }
  if (latestNote) {
    elements.groupGamingStateList.append(gamingStatePill(`Latest note: ${compactStatusText(latestNote)}`));
  }
  if (campaignState.pendingRollRequest) {
    elements.groupGamingStateList.append(gamingStatePill(pendingRollLabel(campaignState.pendingRollRequest)));
  }
  const lastRoll = campaignState.rollHistory?.at(-1);
  if (lastRoll) {
    elements.groupGamingStateList.append(gamingStatePill(`Last outcome: ${rollOutcomeLabel(lastRoll.result)}`));
  }
  if (campaignState.lastKeeperMessage?.sentAt) {
    elements.groupGamingStateList.append(
      gamingStatePill(`Last sent: ${formatSceneTimestamp(campaignState.lastKeeperMessage.sentAt)}`)
    );
  }
  if (campaignState.pendingDecision?.keeperMessage) {
    elements.groupGamingStateList.append(
      gamingStatePill(`Keeper suggestion: ${campaignState.pendingDecision.keeperMessage}`)
    );
  }
}

function statusLabel(status: GroupCampaignStateSummary["status"]): string {
  if (status === "initialized") {
    return "Initialized";
  }
  if (status === "active") {
    return "Active";
  }
  if (status === "paused") {
    return "Paused";
  }
  return "Completed";
}

function countWithTotal(value: number, total: number | undefined): string {
  if (typeof total !== "number" || total <= 0) {
    return String(value);
  }
  return `${value}/${total}`;
}

function compactStatusText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function pendingRollLabel(roll: NonNullable<GroupCampaignStateSummary["pendingRollRequest"]>): string {
  const actor = roll.request.actor ? `${roll.request.actor} ` : "";
  const modifier = roll.request.modifier > 0 ? `+${roll.request.modifier}` : String(roll.request.modifier);
  return `Pending roll: ${actor}${modifier}`;
}

function rollOutcomeLabel(result: { outcome: "10+" | "7-9" | "6-"; total: number }): string {
  if (result.total >= 12) {
    return "perfect success";
  }
  if (result.outcome === "10+") {
    return "success";
  }
  if (result.outcome === "7-9") {
    return "partial success with complication";
  }
  if (result.total <= 3) {
    return "critical failure";
  }
  return "failure with complication";
}

function gamingStatePill(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function selectedCampaignFor(
  campaignId: string | undefined,
  campaigns: CampaignPackSummary[]
): CampaignPackSummary | undefined {
  return (campaignId ? campaigns.find((campaign) => campaign.id === campaignId) : campaigns[0]) ?? campaigns[0];
}

function selectedMysteryFor(
  mysteryId: string | undefined,
  campaign: CampaignPackSummary | undefined
): CampaignPackSummary["mysteries"][number] | undefined {
  return (
    (mysteryId ? campaign?.mysteries.find((mystery) => mystery.id === mysteryId) : campaign?.mysteries[0]) ??
    campaign?.mysteries[0]
  );
}

function automationModeLabel(value: string | undefined): string {
  if (value === "autonomous") {
    return "Autonomous";
  }
  if (value === "suggest") {
    return "Suggest";
  }
  return "Observe";
}

function renderLocalSceneTab(scope: "kin" | "group", selectedEntity: KinSummary | GroupSummary | null): void {
  const scene = currentLocalScene(scope);
  const brief = currentPreviouslyOnBrief(scope);
  const ledger = currentSceneLedger(scope);
  renderLocalSceneContent(scene ? localSceneContent(scene) : "No local scene metadata has been captured yet.", {
    stats: localSceneStats(scope, selectedEntity, scene)
  });
  renderPreviouslyOnPanel(scope, selectedEntity, brief);
  renderDirectorPanel(scope, selectedEntity, ledger);
  renderLocalSceneForceButton(scope, selectedEntity);
}

function renderLocalSceneContent(content: string, input: { stats: Array<{ label: string; value: string }> }): void {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content", "form-detail-content");
  elements.kinDetailContent.classList.add("scene-detail-content");
  elements.fieldContent.hidden = false;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = true;
  elements.groupAudioPanel.hidden = true;
  elements.groupBackgroundPanel.hidden = true;
  elements.groupGamingPanel.hidden = true;
  elements.kinHermesForm.hidden = true;
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;
  elements.fieldContent.replaceChildren();
  elements.fieldContent.textContent = content;
  renderDetailStats(input.stats);
}

function renderPreviouslyOnPanel(
  scope: "kin" | "group",
  selectedEntity: KinSummary | GroupSummary | null,
  brief: PreviouslyOnBriefSummary | null
): void {
  if (!selectedEntity) {
    return;
  }

  renderPreviouslyOnPanelContent({
    container: elements.previouslyOnPanel,
    title:
      `Previously On ${selectedEntity.name || (scope === "group" ? state.selectedGroupId : state.selectedKinId) || ""}`.trim(),
    brief,
    catchup: currentPrewarmState(scope),
    refreshSaving: state.previouslyOnForceSaving,
    formatTimestamp: formatSceneTimestamp,
    onRefresh: () => {
      void forceSelectedPreviouslyOnPrewarm(scope);
    }
  });
}

function renderDirectorPanel(
  scope: "kin" | "group",
  selectedEntity: KinSummary | GroupSummary | null,
  ledger: SceneLedgerSummary | null
): void {
  if (!selectedEntity) {
    return;
  }

  const facts = [...(ledger?.facts || [])].sort((left, right) =>
    String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
  );
  const title =
    `Director ${selectedEntity.name || (scope === "group" ? state.selectedGroupId : state.selectedKinId) || ""}`.trim();
  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const meta = document.createElement("p");
  meta.className = "director-meta";
  meta.textContent = ledger
    ? `${facts.length} fact${facts.length === 1 ? "" : "s"} · Updated ${formatSceneTimestamp(ledger.updatedAt || "")}`
    : "No ledger yet";
  header.append(heading, meta);

  elements.directorPanel.append(header);
  if (!facts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-line";
    empty.textContent = "No Director ledger facts have been captured for this source yet.";
    elements.directorPanel.append(empty);
    elements.directorPanel.hidden = false;
    return;
  }

  const list = document.createElement("div");
  list.className = "director-fact-list";
  for (const fact of facts.slice(0, 12)) {
    list.append(renderDirectorFact(fact));
  }
  elements.directorPanel.append(list);

  if (facts.length > 12) {
    const overflow = document.createElement("p");
    overflow.className = "director-meta";
    overflow.textContent = `${facts.length - 12} additional fact${facts.length - 12 === 1 ? "" : "s"} retained in the ledger.`;
    elements.directorPanel.append(overflow);
  }

  elements.directorPanel.hidden = false;
}

function renderDirectorFact(fact: SceneLedgerFactSummary): HTMLElement {
  const item = document.createElement("article");
  item.className = "director-fact";

  const heading = document.createElement("div");
  heading.className = "director-fact-heading";
  const kind = document.createElement("span");
  kind.className = "director-kind";
  kind.textContent = formatDirectorKind(fact.kind);
  const value = document.createElement("strong");
  value.textContent = fact.value || "Unknown fact";
  heading.append(kind, value);

  const meta = document.createElement("p");
  meta.className = "director-meta";
  meta.textContent = [
    fact.confidence ? `Confidence ${fact.confidence}` : "",
    fact.reviewStatus ? `Review ${fact.reviewStatus}` : "",
    fact.status ? `Status ${fact.status}` : "",
    fact.updatedAt ? `Updated ${formatSceneTimestamp(fact.updatedAt)}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  item.append(heading, meta);
  if (fact.reason) {
    const reason = document.createElement("p");
    reason.className = "director-reason";
    reason.textContent = fact.reason;
    item.append(reason);
  }
  const evidence = fact.provenance?.evidence?.filter((entry): entry is string => typeof entry === "string");
  if (evidence?.length) {
    const line = document.createElement("p");
    line.className = "director-evidence";
    line.textContent = `Evidence: ${evidence.slice(0, 2).join(" / ")}`;
    item.append(line);
  }

  return item;
}

function renderLocalSceneForceButton(scope: "kin" | "group", selectedEntity: KinSummary | GroupSummary | null): void {
  if (!selectedEntity) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact";
  button.textContent = state.localSceneForceSaving ? "Prewarming" : "Force Prewarm";
  button.disabled = state.localSceneForceSaving;
  button.addEventListener("click", () => {
    void forceSelectedLocalScenePrewarm(scope);
  });

  elements.localSceneActions.hidden = false;
  elements.localSceneActions.replaceChildren(button);
}

async function forceSelectedLocalScenePrewarm(scope: "kin" | "group"): Promise<void> {
  const id = scope === "group" ? state.selectedGroupId : state.selectedKinId;
  if (!id || state.localSceneForceSaving) {
    return;
  }

  state.localSceneForceSaving = true;
  renderActivity();
  try {
    await window.kinagent.forceLocalScenePrewarm({ scope, id });
    await refreshStatus();
    elements.monitorLine.textContent = "Scene prewarm requested.";
  } catch (error) {
    elements.monitorLine.textContent = errorMessage(error);
  } finally {
    state.localSceneForceSaving = false;
    renderActivity();
  }
}

async function forceSelectedPreviouslyOnPrewarm(scope: "kin" | "group"): Promise<void> {
  const id = scope === "group" ? state.selectedGroupId : state.selectedKinId;
  if (!id || state.previouslyOnForceSaving) {
    return;
  }

  state.previouslyOnForceSaving = true;
  renderActivity();
  try {
    await window.kinagent.forcePreviouslyOnPrewarm({ scope, id });
    await refreshStatus();
    elements.monitorLine.textContent = "Continuity recap refresh requested.";
  } catch (error) {
    elements.monitorLine.textContent = errorMessage(error);
  } finally {
    state.previouslyOnForceSaving = false;
    renderActivity();
  }
}

async function forceSelectedGroupBackgroundPrewarm(): Promise<void> {
  if (!state.selectedGroupId || state.groupBackgroundForceSaving) {
    return;
  }

  state.groupBackgroundForceSaving = true;
  state.groupBackgroundError = null;
  renderActivity();
  try {
    await window.kinagent.forceGroupBackgroundPrewarm({ groupId: state.selectedGroupId });
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
    await refreshStatus();
    elements.monitorLine.textContent = "Background prewarm requested.";
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
    elements.monitorLine.textContent = state.groupBackgroundError;
  } finally {
    state.groupBackgroundForceSaving = false;
    renderActivity();
  }
}

async function saveSelectedGroupBackground(preference: GroupBackgroundPreference): Promise<void> {
  if (!state.selectedGroupId || state.groupBackgroundSaving) {
    return;
  }

  state.groupBackgroundSaving = true;
  state.groupBackgroundError = null;
  renderActivity();

  try {
    state.selectedGroupBackground = await window.kinagent.setGroupBackgroundPreference({
      groupId: state.selectedGroupId,
      preference
    });
    elements.monitorLine.textContent = state.selectedGroupBackground.preference?.autonomous
      ? "Autonomous background updates enabled."
      : state.selectedGroupBackground.preference?.enabled
        ? "Background proposals enabled."
        : "Background proposals disabled.";
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
    elements.monitorLine.textContent = state.groupBackgroundError;
  } finally {
    state.groupBackgroundSaving = false;
  }
  renderActivity();
}

async function forceSelectedSoundscapePrewarm(scope: "kin" | "group"): Promise<void> {
  const id = scope === "group" ? state.selectedGroupId : state.selectedKinId;
  if (!id) {
    return;
  }

  if (scope === "group") {
    if (state.groupSoundscapeForceSaving) {
      return;
    }
    state.groupSoundscapeForceSaving = true;
  } else {
    if (state.soundscapeForceSaving) {
      return;
    }
    state.soundscapeForceSaving = true;
  }

  renderActivity();
  try {
    await window.kinagent.forceSoundscapePrewarm({ scope, id });
    await refreshStatus();
    elements.monitorLine.textContent = "Soundscape prewarm requested.";
  } catch (error) {
    elements.monitorLine.textContent = errorMessage(error);
  } finally {
    if (scope === "group") {
      state.groupSoundscapeForceSaving = false;
    } else {
      state.soundscapeForceSaving = false;
    }
    renderActivity();
  }
}

async function saveSelectedGroupSoundscape(): Promise<void> {
  if (!state.selectedGroupId || state.groupSoundscapeSaving) {
    return;
  }

  const preference: GroupSoundscapePreference = {
    enabled: elements.groupSoundscapeEnabledInput.checked
  };

  state.groupSoundscapeSaving = true;
  state.groupSoundscapeError = null;
  renderActivity();
  try {
    const saved = await window.kinagent.setGroupSoundscapePreference({
      groupId: state.selectedGroupId,
      preference
    });
    state.selectedGroupSoundscape = saved;
    state.groupSubscriptions = state.groupSubscriptions.map((subscription) =>
      subscription.group?.groupId === state.selectedGroupId
        ? { ...subscription, soundscape: saved.soundscape || { enabled: false } }
        : subscription
    );
    if (!saved.soundscape?.enabled) {
      delete state.soundscapeUpdates[`group:${state.selectedGroupId}`];
    }
    void applyActiveSoundscape();
    renderSoundscapeStatus();
    elements.monitorLine.textContent = "Group audio settings saved.";
  } catch (error) {
    state.groupSoundscapeError = errorMessage(error);
  } finally {
    state.groupSoundscapeSaving = false;
    renderActivity();
  }
}

async function saveSelectedGroupGaming(): Promise<void> {
  if (!state.selectedGroupId || state.groupGamingSaving) {
    return;
  }

  const preference: GroupGamingPreference = {
    enabled: elements.groupGamingEnabledInput.checked,
    campaignId: elements.groupGamingCampaignInput.value,
    mysteryId: elements.groupGamingMysteryInput.value,
    automationMode: groupGamingAutomationMode()
  };

  state.groupGamingSaving = true;
  state.groupGamingError = null;
  renderActivity();
  try {
    state.selectedGroupGaming = await window.kinagent.setGroupGamingPreference({
      groupId: state.selectedGroupId,
      preference
    });
    elements.monitorLine.textContent = "Group Gaming settings saved.";
  } catch (error) {
    state.groupGamingError = errorMessage(error);
  } finally {
    state.groupGamingSaving = false;
    renderActivity();
  }
}

async function approveGroupGamingKeeperSuggestion(): Promise<void> {
  if (!state.selectedGroupId || state.groupGamingApproving) {
    return;
  }

  state.groupGamingApproving = true;
  state.groupGamingError = null;
  renderActivity();
  try {
    state.selectedGroupGaming = await window.kinagent.approveGroupGamingKeeperSuggestion({
      groupId: state.selectedGroupId
    });
    elements.monitorLine.textContent = "Keeper suggestion sent.";
  } catch (error) {
    state.groupGamingError = errorMessage(error);
  } finally {
    state.groupGamingApproving = false;
    renderActivity();
  }
}

async function importGroupCampaignPack(): Promise<void> {
  if (state.groupGamingImporting) {
    return;
  }

  state.groupGamingImporting = true;
  state.groupGamingError = null;
  renderActivity();
  try {
    const result = await window.kinagent.importCampaignPack();
    if (result.canceled) {
      return;
    }
    if (state.selectedGroupId) {
      state.selectedGroupGaming = await window.kinagent.getGroupGamingPreference({ groupId: state.selectedGroupId });
    }
    elements.monitorLine.textContent = result.campaign
      ? `Imported campaign: ${result.campaign.title}.`
      : "Campaign pack imported.";
  } catch (error) {
    state.groupGamingError = errorMessage(error);
  } finally {
    state.groupGamingImporting = false;
    renderActivity();
  }
}

function groupGamingAutomationMode(): GroupGamingPreference["automationMode"] {
  const value = elements.groupGamingAutomationInput.value;
  if (value === "suggest" || value === "autonomous") {
    return value;
  }
  return "observe";
}

function renderDetailStats(stats: Array<{ label: string; value: string }>): void {
  elements.detailStats.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    elements.detailStats.append(item);
  }
}

function resetKinActionPlaceholders(): void {
  elements.chatExportFromInput.value = "";
  elements.chatExportToInput.value = "";
  elements.kinAnalyzeProgress.hidden = true;
  elements.kinAnalyzeProgress.value = 0;
  state.kinAnalysisReport = "";
  elements.chatExportProgress.hidden = true;
  elements.chatExportProgress.value = 0;
  elements.kinAnalyzeStatusLine.textContent = "";
  elements.kinAnalyzeReport.hidden = true;
  elements.kinAnalyzeReport.replaceChildren();
  elements.chatExportStatusLine.textContent = "";
}

async function acceptJournalSuggestion(id: string): Promise<void> {
  state.journalSavingId = id;
  state.journalError = null;
  renderActivity();
  try {
    await window.kinagent.acceptJournalSuggestion({ id });
    state.journalSuggestions = await window.kinagent.listJournalSuggestions();
    if (state.selectedKinId) {
      state.selectedKinCapture = await withTimeout(
        window.kinagent.getCapturedKin({ kinId: state.selectedKinId }),
        captureRequestTimeoutMs,
        "Captured settings request timed out."
      );
    }
    elements.monitorLine.textContent = "Journal review accepted and capture refreshed.";
  } catch (error) {
    state.journalError = errorMessage(error);
  } finally {
    state.journalSavingId = null;
    renderActivity();
  }
}

async function deleteInvalidatedJournalSuggestion(id: string): Promise<void> {
  state.journalSavingId = id;
  state.journalError = null;
  renderActivity();
  try {
    await window.kinagent.deleteInvalidatedJournalSuggestion({ id });
    state.journalSuggestions = await window.kinagent.listJournalSuggestions();
    if (state.selectedKinId) {
      state.selectedKinCapture = await withTimeout(
        window.kinagent.getCapturedKin({ kinId: state.selectedKinId }),
        captureRequestTimeoutMs,
        "Captured settings request timed out."
      );
    }
    elements.monitorLine.textContent = "Invalidated journal entry deleted and capture refreshed.";
  } catch (error) {
    state.journalError = errorMessage(error);
  } finally {
    state.journalSavingId = null;
    renderActivity();
  }
}

async function dismissJournalSuggestion(id: string): Promise<void> {
  state.journalError = null;
  try {
    await window.kinagent.dismissJournalSuggestion({ id });
    state.journalSuggestions = await window.kinagent.listJournalSuggestions();
  } catch (error) {
    state.journalError = errorMessage(error);
  }
  renderActivity();
}

async function focusJournalSuggestion(suggestion: JournalSuggestionSummary | null | undefined): Promise<void> {
  if (!suggestion?.aiId) {
    return;
  }

  state.activeTab = "journal";
  await selectKin(suggestion.aiId);
  state.activeTab = "journal";
  renderActivity();
}

async function dismissGroupBackgroundSuggestion(id: string): Promise<void> {
  state.groupBackgroundSavingId = id;
  state.groupBackgroundSavingAction = "dismiss";
  state.groupBackgroundError = null;
  renderActivity();
  try {
    await window.kinagent.dismissGroupBackgroundSuggestion({ id });
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
  } finally {
    state.groupBackgroundSavingId = null;
    state.groupBackgroundSavingAction = null;
  }
  renderActivity();
}

async function generateGroupBackgroundImage(id: string): Promise<void> {
  if (!id || state.groupBackgroundSavingId) {
    return;
  }

  state.groupBackgroundSavingId = id;
  state.groupBackgroundSavingAction = "generate";
  state.groupBackgroundError = null;
  renderActivity();
  try {
    await window.kinagent.generateGroupBackgroundImage({ id });
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
    elements.monitorLine.textContent = "Background image generated.";
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
    elements.monitorLine.textContent = state.groupBackgroundError;
  } finally {
    state.groupBackgroundSavingId = null;
    state.groupBackgroundSavingAction = null;
  }
  renderActivity();
}

async function applyGroupBackgroundImage(id: string): Promise<void> {
  if (!id || state.groupBackgroundSavingId) {
    return;
  }

  state.groupBackgroundSavingId = id;
  state.groupBackgroundSavingAction = "apply";
  state.groupBackgroundError = null;
  renderActivity();
  try {
    await window.kinagent.applyGroupBackgroundImage({ id });
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
    elements.monitorLine.textContent = "Background image applied to Kindroid.";
  } catch (error) {
    state.groupBackgroundError = errorMessage(error);
    state.groupBackgroundSuggestions = await window.kinagent.listGroupBackgroundSuggestions();
    elements.monitorLine.textContent = state.groupBackgroundError;
  } finally {
    state.groupBackgroundSavingId = null;
    state.groupBackgroundSavingAction = null;
  }
  renderActivity();
}

function currentCapturedField(): CapturedFieldSummary | null {
  if (state.selectedGroupId) {
    return state.selectedGroupCapture?.fields?.find((field) => field.key === state.activeTab) || null;
  }

  return state.selectedKinCapture?.fields?.find((field) => field.key === state.activeTab) || null;
}

function currentLocalScene(scope: "kin" | "group"): LocalSceneStateSummary | null {
  if (scope === "group") {
    return (
      state.localScenes.find((scene) => scene.scope === "group" && scene.groupId === state.selectedGroupId) || null
    );
  }

  return state.localScenes.find((scene) => scene.scope === "kin" && scene.kinId === state.selectedKinId) || null;
}

function currentSceneLedger(scope: "kin" | "group"): SceneLedgerSummary | null {
  if (scope === "group") {
    return (
      state.sceneLedgers.find((ledger) => ledger.scope === "group" && ledger.groupId === state.selectedGroupId) || null
    );
  }

  return state.sceneLedgers.find((ledger) => ledger.scope === "kin" && ledger.kinId === state.selectedKinId) || null;
}

function currentPreviouslyOnBrief(scope: "kin" | "group"): PreviouslyOnBriefSummary | null {
  if (scope === "group") {
    return (
      state.previouslyOnBriefs.find((brief) => brief.scope === "group" && brief.groupId === state.selectedGroupId) ||
      null
    );
  }

  return state.previouslyOnBriefs.find((brief) => brief.scope === "kin" && brief.kinId === state.selectedKinId) || null;
}

function currentPrewarmState(scope: "kin" | "group"): PrewarmSourceSummary | null {
  const id = scope === "group" ? state.selectedGroupId : state.selectedKinId;
  if (!id) {
    return null;
  }

  return state.prewarmStates.find((prewarm) => prewarm.sourceKey === `${scope}:${id}`) || null;
}

function upsertLocalScene(scene: LocalSceneStateSummary | null | undefined): void {
  if (!scene?.scope) {
    return;
  }

  const sameSource = (current: LocalSceneStateSummary): boolean =>
    scene.scope === "group"
      ? current.scope === "group" && current.groupId === scene.groupId
      : current.scope === "kin" && current.kinId === scene.kinId;
  state.localScenes = [scene, ...state.localScenes.filter((current) => !sameSource(current))];
}

function upsertPreviouslyOnBrief(brief: PreviouslyOnBriefSummary | null | undefined): void {
  if (!brief?.scope) {
    return;
  }

  const sameSource = (current: PreviouslyOnBriefSummary): boolean =>
    brief.scope === "group"
      ? current.scope === "group" && current.groupId === brief.groupId
      : current.scope === "kin" && current.kinId === brief.kinId;
  state.previouslyOnBriefs = [brief, ...state.previouslyOnBriefs.filter((current) => !sameSource(current))];
}

function upsertGroupCampaignState(campaignState: GroupCampaignStateSummary | null | undefined): void {
  if (!campaignState?.groupId || campaignState.groupId !== state.selectedGroupId || !state.selectedGroupGaming) {
    return;
  }

  state.selectedGroupGaming = {
    ...state.selectedGroupGaming,
    activeState: campaignState
  };
}

function upsertPrewarmState(prewarm: PrewarmSourceSummary | null | undefined): void {
  if (!prewarm?.sourceKey) {
    return;
  }

  state.prewarmStates = [prewarm, ...state.prewarmStates.filter((current) => current.sourceKey !== prewarm.sourceKey)];
}

function localSceneContent(scene: LocalSceneStateSummary): string {
  const content = {
    location: scene.location || undefined,
    timeOfDay: scene.timeOfDay || undefined,
    mood: scene.mood || undefined,
    activity: scene.activity || undefined,
    tension: typeof scene.tension === "number" ? scene.tension : undefined,
    privacy: scene.privacy || undefined,
    soundscape: scene.soundscape || undefined,
    visualPalette: scene.visualPalette || undefined,
    suggestedUiAccent: scene.suggestedUiAccent || undefined,
    reason: scene.reason || undefined,
    evidence: scene.evidence?.length ? scene.evidence : undefined
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

function localSceneStats(
  scope: "kin" | "group",
  selectedEntity: KinSummary | GroupSummary | null,
  scene: LocalSceneStateSummary | null
): DetailStat[] {
  const entityId = scope === "group" ? state.selectedGroupId : state.selectedKinId;
  return [
    { label: scope === "group" ? "Group" : "Kin", value: selectedEntity?.name || entityId || "Unknown" },
    { label: "Updated", value: scene?.updatedAt ? formatSceneTimestamp(scene.updatedAt) : "None" },
    { label: "Source", value: scene?.sourceDocumentId || "Unavailable" },
    { label: "Mode", value: "Local only" }
  ];
}

function formatSceneTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDirectorKind(value: string | null | undefined): string {
  if (!value) {
    return "Fact";
  }
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isKinTab(tab: string): boolean {
  return [
    "backstory",
    "directive",
    "memory",
    "example",
    "scene",
    "background",
    "profile",
    "local-scene",
    "journal",
    "hermes",
    "voice",
    "analyze",
    "export"
  ].includes(tab);
}

function isGroupTab(tab: string): boolean {
  return [
    "group-context",
    "group-directive",
    "group-scene",
    "group-scene-suggestion",
    "group-members",
    "group-profile",
    "group-local-scene",
    "group-audio",
    "group-gaming",
    "group-export"
  ].includes(tab);
}

function currentSelectedKin(): KinSummary | null {
  return state.kins.find((kin) => kin.aiId === state.selectedKinId) || null;
}

function currentSelectedGroup(): GroupSummary | null {
  return state.groups.find((group) => group.groupId === state.selectedGroupId) || null;
}

function clearMissingSelectedKin(): void {
  if (!state.selectedKinId) {
    return;
  }

  if (!state.kins.some((kin) => kin.aiId === state.selectedKinId)) {
    state.selectedKinId = null;
    state.selectedKinCapture = null;
    state.selectedKinVoice = null;
    state.selectedKinAmbient = null;
    state.captureError = null;
    state.voiceError = null;
    state.ambientError = null;
    state.captureLoading = false;
    state.voiceLoading = false;
    state.ambientLoading = false;
    resetKinActionPlaceholders();
    state.activeTab = "monitor";
    state.selectedHistoryHash = null;
  }
}

function clearMissingSelectedGroup(): void {
  if (!state.selectedGroupId) {
    return;
  }

  if (!state.groups.some((group) => group.groupId === state.selectedGroupId)) {
    state.selectedGroupId = null;
    state.selectedGroupCapture = null;
    state.selectedGroupSoundscape = null;
    state.selectedGroupGaming = null;
    state.captureError = null;
    state.groupSoundscapeError = null;
    state.groupGamingError = null;
    state.captureLoading = false;
    state.groupSoundscapeLoading = false;
    state.groupGamingLoading = false;
    resetKinActionPlaceholders();
    state.activeTab = "monitor";
    state.selectedHistoryHash = null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function runAction(label: string, action: () => Promise<unknown>): Promise<void> {
  const previous = elements.monitorLine.textContent;
  elements.monitorLine.textContent = label;
  try {
    await action();
  } catch (error) {
    elements.monitorLine.textContent = errorMessage(error);
    return;
  }

  if (elements.monitorLine.textContent === label) {
    elements.monitorLine.textContent = previous;
  }
}

function updateMonitorRunning() {
  state.monitorRunning =
    state.subscriptions.some((subscription) => subscription.running) ||
    state.groupSubscriptions.some((subscription) => subscription.running);
}

function handleSoundscapeUpdate(update: ScopedSoundscapeUpdate | undefined): void {
  const key = soundscapeKeyForUpdate(update);
  if (!key || !update?.state) {
    return;
  }

  if (!isSoundscapeEnabledForKey(key)) {
    return;
  }

  state.soundscapeUpdates[key] = update;
  if (state.activeSoundscapeKey === key) {
    void applyActiveSoundscape();
  }
  renderSoundscapeStatus();
}

function soundscapeUpdatesFromList(updates: ScopedSoundscapeUpdate[]): Record<string, ScopedSoundscapeUpdate> {
  const next: Record<string, ScopedSoundscapeUpdate> = {};
  for (const update of updates) {
    const key = soundscapeKeyForUpdate(update);
    if (key && update.state) {
      next[key] = update;
    }
  }
  return next;
}

function activateSoundscapeFromPayload(payload: { groupId?: unknown; kinId?: unknown } | undefined): void {
  const key = soundscapeKeyFromPayload(payload);
  if (!key || state.activeSoundscapeKey === key) {
    return;
  }

  state.activeSoundscapeKey = key;
  void applyActiveSoundscape();
  renderSoundscapeStatus();
}

function deactivateSoundscapeFromPayload(payload: { groupId?: unknown; kinId?: unknown } | undefined): void {
  if (!shouldDeactivateActiveSoundscape(state.activeSoundscapeKey, payload)) {
    return;
  }

  state.activeSoundscapeKey = null;
  state.lastSoundscapeCue = null;
  void applyActiveSoundscape();
  renderSoundscapeStatus();
}

async function applyActiveSoundscape(): Promise<void> {
  if (!state.activeSoundscapeKey || !isSoundscapeEnabledForKey(state.activeSoundscapeKey)) {
    await soundscapeController.update(silentSoundscapeState);
    return;
  }

  const update = state.soundscapeUpdates[state.activeSoundscapeKey];
  await soundscapeController.update(update?.state ?? silentSoundscapeState);
}

function renderSoundscapeStatus(): void {
  if (state.activeTab === "group-audio" && state.selectedGroupId) {
    const key = `group:${state.selectedGroupId}`;
    renderSoundscapeLayerList(
      elements.groupSoundscapeLayerList,
      state.soundscapeUpdates[key]?.state,
      activeCueLabel(key)
    );
    return;
  }

  if (state.activeTab !== "voice" || !state.selectedKinId) {
    return;
  }

  const key = `kin:${state.selectedKinId}`;
  renderSoundscapeLayerList(elements.soundscapeLayerList, state.soundscapeUpdates[key]?.state, activeCueLabel(key));
}

function renderSoundscapeLayerList(
  container: HTMLElement,
  soundscape: SoundscapeState | undefined,
  activeCue: string | null = null
): void {
  container.replaceChildren();
  const layers = soundscape?.layers ?? [];
  if (layers.length === 0 && !activeCue) {
    const item = document.createElement("li");
    item.textContent = "silent";
    container.append(item);
    return;
  }

  for (const layer of layers) {
    const item = document.createElement("li");
    const sample = soundscape ? describeSoundscapeLayerSample(soundscape, layer) : null;
    item.textContent = `${layer.type} ${Math.round(layer.volume * 100)}%${sample ? ` · ${sample}` : ""}`;
    container.append(item);
  }

  if (activeCue) {
    const item = document.createElement("li");
    item.textContent = `cue · ${activeCue}`;
    container.append(item);
  }
}

function activeCueLabel(key: string): string | null {
  const cue = state.lastSoundscapeCue;
  if (!cue || cue.key !== key || cue.expiresAt <= Date.now()) {
    return null;
  }

  return cue.label;
}

function isSoundscapeEnabledForKey(key: string): boolean {
  const [scope, id] = key.split(":", 2);
  if (scope === "group") {
    return Boolean(
      state.groupSubscriptions.find((subscription) => subscription.group?.groupId === id)?.soundscape?.enabled
    );
  }

  return Boolean(state.subscriptions.find((subscription) => subscription.kin?.aiId === id)?.soundscape?.enabled);
}

function soundscapeKeyForUpdate(update: ScopedSoundscapeUpdate | undefined): string | null {
  if (update?.scope === "group" && update.groupId) {
    return `group:${update.groupId}`;
  }

  if (update?.scope === "kin" && update.kinId) {
    return `kin:${update.kinId}`;
  }

  return null;
}
