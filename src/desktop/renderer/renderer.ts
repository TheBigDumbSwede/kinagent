import { analyzeSelectedKin, renderKinAnalysisProgress } from "./analysisPanel.js";
import { renderGroupExportTab, renderKinAnalyzeTab, renderKinExportTab } from "./actionPanels.js";
import { renderAppSettingsTab, saveAppSettings } from "./appSettingsForm.js";
import { createVoiceAudioPlayer, type VoiceAudioPayload } from "./audioPlayback.js";
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
import { SoundscapeController } from "./SoundscapeController.js";
import { describeSoundscapeLayerSample } from "./SoundscapeSampleSelection.js";
import { silentSoundscapeState, type SoundscapeState } from "../../soundscape/SoundscapeState.js";
import type {
  AppSettingsResult,
  AppSettingsFormValue,
  CapturedFieldSummary,
  CapturedKinSummary,
  ChatExportProgress,
  ChatExportRequest,
  ChatExportResult,
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
  KinVoicePreferenceResult
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
  selectedKinVoice: KinVoicePreferenceResult | null;
  selectedKinAmbient: KinAmbientPreferenceResult | null;
  journalSuggestions: JournalSuggestionSummary[];
  journalSavingId: string | null;
  journalError: string | null;
  captureLoading: boolean;
  captureError: string | null;
  voiceLoading: boolean;
  voiceError: string | null;
  voiceSaving: boolean;
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
  settingTabs: HTMLElement;
  monitorPane: HTMLElement;
  detailPane: HTMLElement;
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  detailStats: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  fieldContent: HTMLElement;
  appSettingsForm: HTMLFormElement;
  appSettingsStatusLine: HTMLElement;
  appSettingsSaveButton: HTMLButtonElement;
  settingsPathLine: HTMLElement;
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
  voiceForm: HTMLFormElement;
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
  openKindroid(): Promise<unknown>;
  startLogin(): Promise<unknown>;
  saveLogin(): Promise<unknown>;
  setKinEnabled(input: { kinId: string; enabled: boolean }): Promise<unknown>;
  refreshKins(): Promise<unknown>;
  setGroupEnabled(input: { groupId: string; enabled: boolean }): Promise<unknown>;
  refreshGroups(): Promise<unknown>;
  getCapturedKin(input: { kinId: string }): Promise<CapturedKinResult>;
  listJournalSuggestions(): Promise<JournalSuggestionSummary[]>;
  acceptJournalSuggestion(input: { id: string }): Promise<unknown>;
  deleteInvalidatedJournalSuggestion(input: { id: string }): Promise<unknown>;
  dismissJournalSuggestion(input: { id: string }): Promise<unknown>;
  getKinVoicePreference(input: { kinId: string }): Promise<KinVoicePreferenceResult>;
  setKinVoicePreference(input: { kinId: string; preference: KinVoicePreference }): Promise<KinVoicePreferenceResult>;
  getKinAmbientPreference(input: { kinId: string }): Promise<KinAmbientPreferenceResult>;
  setKinAmbientPreference(input: {
    kinId: string;
    enabled: boolean;
    chatDynamism: KinChatDynamismPreference;
  }): Promise<KinAmbientPreferenceResult>;
  exportKinChat(input: ChatExportRequest & { kinId: string }): Promise<ChatExportResult>;
  exportGroupChat(input: ChatExportRequest & { groupId: string }): Promise<ChatExportResult>;
  analyzeKin(input: { kinId: string }): Promise<KinAnalysisResult>;
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
  selectedKinVoice: null,
  selectedKinAmbient: null,
  journalSuggestions: [],
  journalSavingId: null,
  journalError: null,
  captureLoading: false,
  captureError: null,
  voiceLoading: false,
  voiceError: null,
  voiceSaving: false,
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
  settingTabs: query<HTMLElement>("#settingTabs"),
  monitorPane: query<HTMLElement>("#monitorPane"),
  detailPane: query<HTMLElement>("#detailPane"),
  kinDetailEmpty: query<HTMLElement>("#kinDetailEmpty"),
  kinDetailContent: query<HTMLElement>("#kinDetailContent"),
  detailStats: query<HTMLElement>("#detailStats"),
  journalSuggestionPanel: query<HTMLElement>("#journalSuggestionPanel"),
  fieldContent: query<HTMLElement>("#fieldContent"),
  appSettingsForm: query<HTMLFormElement>("#appSettingsForm"),
  appSettingsStatusLine: query<HTMLElement>("#appSettingsStatusLine"),
  appSettingsSaveButton: query<HTMLButtonElement>("#appSettingsSaveButton"),
  settingsPathLine: query<HTMLElement>("#settingsPathLine"),
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
  voiceForm: query<HTMLFormElement>("#voiceForm"),
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

function tabNavigationContext() {
  return {
    state,
    elements,
    loadAppSettings: () => {
      void loadAppSettings();
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
elements.settingTabs.addEventListener("click", (event) => {
  handleSettingTabsClick(tabNavigationContext(), event);
});
elements.voiceProviderInput.addEventListener("change", () => {
  renderVoiceProviderFields(voiceHermesContext());
});
elements.appSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveAppSettings(appSettingsContext());
});
elements.voiceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSelectedKinVoice(voiceHermesContext());
});
elements.soundscapeEnabledInput.addEventListener("change", () => {
  soundscapeController.markUserInteractionReady();
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

  if (message.channel === "soundscape-updated") {
    handleSoundscapeUpdate(message.payload as ScopedSoundscapeUpdate | undefined);
    return;
  }

  if (message.channel === "journal-suggestions-updated") {
    state.journalSuggestions = Array.isArray(message.payload) ? (message.payload as JournalSuggestionSummary[]) : [];
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
    markKinSubscriptionRunning(subscriptionListContext(), message.payload?.kinId, false);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "monitor-error") {
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
    markGroupSubscriptionRunning(subscriptionListContext(), message.payload?.groupId, false);
    updateMonitorRunning();
    renderMonitorState(monitorPanelContext());
    return;
  }

  if (message.channel === "group-monitor-error") {
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
  state.activeTab = ["monitor", "app-settings"].includes(state.activeTab) ? "backstory" : state.activeTab;
  state.selectedHistoryHash = null;
  state.captureLoading = true;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
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
  state.activeTab = "monitor";
  state.selectedHistoryHash = null;
  state.captureLoading = false;
  state.captureError = null;
  state.selectedKinCapture = null;
  state.selectedKinVoice = null;
  state.selectedKinAmbient = null;
  state.voiceError = null;
  state.ambientError = null;
  state.voiceLoading = false;
  state.ambientLoading = false;
  resetKinActionPlaceholders();
  renderKinSubscriptions(subscriptionListContext());
  renderGroupSubscriptions(subscriptionListContext());
  renderMonitorState(monitorPanelContext());
  renderActivity();
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

function renderActivity(): void {
  const activeTab = state.activeTab || "monitor";
  const activeMode = modeForTab(activeTab);
  const isMonitor = activeMode === "monitor";
  const isVoice = activeMode === "voice";
  const isHermes = activeMode === "hermes";
  const isAnalyze = activeMode === "analyze";
  const isExport = activeMode === "export";
  const isAppSettings = activeMode === "app-settings";

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

  const selectedGroup = currentSelectedGroup();
  if (selectedGroup && isExport) {
    elements.activityTitle.textContent = `${selectedGroup.name || "Group"} · Export`;
    elements.monitorLine.textContent = subtitleForDetailMode(activeMode);
    renderGroupExportTab(actionPanelContext(), selectedGroup);
    return;
  }

  const selectedKin = currentSelectedKin();
  const field = currentCapturedField();
  const tabLabel = field?.label || tabLabelFor(tabNavigationContext(), activeTab);
  elements.activityTitle.textContent = selectedKin ? `${selectedKin.name || "Kin"} · ${tabLabel}` : tabLabel;
  elements.monitorLine.textContent = subtitleForDetailMode(activeMode);

  if (!state.selectedKinId) {
    renderDetailEmpty("Select Manage on a Kin to inspect captured settings.");
    return;
  }

  if (isVoice) {
    renderVoiceTab(voiceHermesContext(), selectedKin);
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

function currentCapturedField(): CapturedFieldSummary | null {
  return state.selectedKinCapture?.fields?.find((field) => field.key === state.activeTab) || null;
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

function activateSoundscapeFromPayload(payload: { groupId?: unknown; kinId?: unknown } | undefined): void {
  const key = soundscapeKeyFromPayload(payload);
  if (!key || state.activeSoundscapeKey === key) {
    return;
  }

  state.activeSoundscapeKey = key;
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
    return true;
  }

  return Boolean(state.subscriptions.find((subscription) => subscription.kin?.aiId === id)?.soundscape?.enabled);
}

function soundscapeKeyFromPayload(payload: { groupId?: unknown; kinId?: unknown } | undefined): string | null {
  const groupId = typeof payload?.groupId === "string" && payload.groupId ? payload.groupId : null;
  if (groupId) {
    return `group:${groupId}`;
  }

  const kinId = typeof payload?.kinId === "string" && payload.kinId ? payload.kinId : null;
  return kinId ? `kin:${kinId}` : null;
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
