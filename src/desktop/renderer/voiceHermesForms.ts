import { providerLabel } from "./formatters.js";
import type {
  ChatDynamismValue,
  KinagentApi,
  KinAmbientPreferenceResult,
  KinChatDynamismPreference,
  KinSoundscapePreference,
  KinSummary,
  KinVoicePreference,
  KinVoicePreferenceResult,
  SubscriptionSummary
} from "./rendererTypes.js";

export interface ChatDynamismSlider {
  hardMin: number;
  hardMax: number;
  practicalMin: number;
  practicalMax: number;
}

export interface VoiceHermesState {
  selectedKinId: string | null;
  selectedKinVoice: KinVoicePreferenceResult | null;
  selectedKinAmbient: KinAmbientPreferenceResult | null;
  voiceLoading: boolean;
  voiceError: string | null;
  voiceSaving: boolean;
  ambientLoading: boolean;
  ambientError: string | null;
  ambientSaving: boolean;
  soundscapeForceSaving: boolean;
  subscriptions: SubscriptionSummary[];
}

export interface VoiceHermesElements {
  kinDetailEmpty: HTMLElement;
  kinDetailContent: HTMLElement;
  fieldContent: HTMLElement;
  journalSuggestionPanel: HTMLElement;
  appSettingsForm: HTMLElement;
  voiceForm: HTMLElement;
  groupAudioPanel: HTMLElement;
  kinHermesForm: HTMLElement;
  kinAnalyzePanel: HTMLElement;
  chatExportPanel: HTMLElement;
  timeline: HTMLElement;
  detailStats: HTMLElement;
  voiceEnabledInput: HTMLInputElement;
  filterNarrationInput: HTMLInputElement;
  voiceProviderInput: HTMLInputElement | HTMLSelectElement;
  openAiVoiceLabel: HTMLElement;
  openAiVoiceInput: HTMLSelectElement;
  elevenLabsVoiceLabel: HTMLElement;
  elevenLabsVoiceInput: HTMLInputElement;
  narrationDelimiterInput: HTMLInputElement;
  openAiInstructionsInput: HTMLInputElement | HTMLTextAreaElement;
  voiceStatusLine: HTMLElement;
  voiceSaveButton: HTMLButtonElement;
  soundscapeEnabledInput: HTMLInputElement;
  soundscapeStatusLine: HTMLElement;
  soundscapeLayerList: HTMLElement;
  soundscapeForcePrewarmButton: HTMLButtonElement;
  ambientContextEnabledInput: HTMLInputElement;
  chatDynamismCurrentValue: HTMLElement;
  chatDynamismRangeControl: HTMLElement;
  chatDynamismEnabledInput: HTMLInputElement;
  chatDynamismMinInput: HTMLInputElement;
  chatDynamismMaxInput: HTMLInputElement;
  chatDynamismMinValue: HTMLElement;
  chatDynamismMaxValue: HTMLElement;
  kinHermesStatusLine: HTMLElement;
  kinHermesSaveButton: HTMLButtonElement;
  monitorLine: HTMLElement;
}

export interface VoiceHermesContext {
  state: VoiceHermesState;
  elements: VoiceHermesElements;
  api: Pick<KinagentApi, "setKinVoicePreference" | "setKinAmbientPreference">;
  renderActivity: () => void;
  renderDetailEmpty: (message: string) => void;
  chatDynamismSlider: ChatDynamismSlider;
  onSoundscapePreferenceChanged?: (kinId: string, preference: KinSoundscapePreference) => void;
  renderSoundscapeLayers?: (container: HTMLElement, kinId: string) => void;
}

export function renderVoiceTab(context: VoiceHermesContext, selectedKin: KinSummary | null): void {
  const { state, elements, renderDetailEmpty } = context;
  if (state.voiceLoading) {
    renderDetailEmpty("Loading audio settings.");
    return;
  }

  if (state.voiceError) {
    renderDetailEmpty(state.voiceError);
    return;
  }

  if (!state.selectedKinVoice?.ok) {
    renderDetailEmpty("No audio settings found for this Kin.");
    return;
  }

  const preference = state.selectedKinVoice.preference || {};
  showFormPanel(elements, "voice");
  elements.voiceEnabledInput.checked = Boolean(preference.enabled);
  elements.voiceProviderInput.value = preference.provider || "openai";
  renderOpenAiVoiceOptions(
    elements,
    state.selectedKinVoice.openAiVoiceOptions || [],
    preference.openaiVoice || "marin"
  );
  elements.elevenLabsVoiceInput.value = preference.elevenLabsVoiceId || "";
  elements.filterNarrationInput.checked = preference.filterNarrationForTts !== false;
  elements.narrationDelimiterInput.value = preference.narrationDelimiter || "*";
  elements.openAiInstructionsInput.value = preference.openaiInstructions || "";
  elements.voiceSaveButton.disabled = state.voiceSaving;
  elements.soundscapeEnabledInput.checked = Boolean(state.selectedKinVoice.soundscape?.enabled);
  elements.soundscapeForcePrewarmButton.disabled =
    state.soundscapeForceSaving || !state.selectedKinVoice.soundscape?.enabled;
  renderVoiceProviderFields(context);
  renderVoiceStatusLine(context);
  renderSoundscapeStatusLine(context);
  context.renderSoundscapeLayers?.(elements.soundscapeLayerList, state.selectedKinId || "");
  renderVoiceStats(context, selectedKin, preference);
}

export function renderKinHermesTab(context: VoiceHermesContext, selectedKin: KinSummary | null): void {
  const { state, elements, renderDetailEmpty, chatDynamismSlider } = context;
  if (state.ambientLoading) {
    renderDetailEmpty("Loading Hermes settings.");
    return;
  }

  if (state.ambientError) {
    renderDetailEmpty(state.ambientError);
    return;
  }

  if (!state.selectedKinAmbient?.ok) {
    renderDetailEmpty("No Hermes settings found for this Kin.");
    return;
  }

  showFormPanel(elements, "hermes");
  elements.ambientContextEnabledInput.checked = state.selectedKinAmbient.enabled !== false;
  const chatDynamism: Partial<KinChatDynamismPreference> = state.selectedKinAmbient.chatDynamism || {};
  elements.chatDynamismCurrentValue.textContent = chatDynamismCurrentLabel(
    state.selectedKinAmbient.currentChatDynamism
  );
  elements.chatDynamismEnabledInput.checked = Boolean(chatDynamism.enabled);
  elements.chatDynamismMinInput.value = String(chatDynamism.min ?? chatDynamismSlider.practicalMin);
  elements.chatDynamismMaxInput.value = String(chatDynamism.max ?? chatDynamismSlider.practicalMax);
  syncChatDynamismRangeLabels(context);
  elements.kinHermesSaveButton.disabled = state.ambientSaving;
  elements.kinHermesStatusLine.textContent = hermesStatusLine(state.selectedKinAmbient);
  renderKinHermesStats(context, selectedKin, state.selectedKinAmbient);
}

export function renderVoiceProviderFields(context: VoiceHermesContext): void {
  const { elements } = context;
  const provider = elements.voiceProviderInput.value;
  elements.openAiVoiceLabel.hidden = provider !== "openai";
  const instructionsLabel = elements.openAiInstructionsInput.closest("label");
  if (instructionsLabel instanceof HTMLElement) {
    instructionsLabel.hidden = provider !== "openai";
  }
  elements.elevenLabsVoiceLabel.hidden = provider !== "elevenlabs";
  renderVoiceStatusLine(context);
}

export async function saveSelectedKinVoice(context: VoiceHermesContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!state.selectedKinId) {
    return;
  }

  const preference: KinVoicePreference = {
    enabled: elements.voiceEnabledInput.checked,
    provider: elements.voiceProviderInput.value,
    openaiVoice: elements.openAiVoiceInput.value,
    openaiInstructions: elements.openAiInstructionsInput.value,
    elevenLabsVoiceId: elements.elevenLabsVoiceInput.value,
    filterNarrationForTts: elements.filterNarrationInput.checked,
    narrationDelimiter: elements.narrationDelimiterInput.value,
    soundscape: {
      enabled: elements.soundscapeEnabledInput.checked
    }
  };

  state.voiceSaving = true;
  renderActivity();
  try {
    state.selectedKinVoice = await api.setKinVoicePreference({
      kinId: state.selectedKinId,
      preference
    });
    context.onSoundscapePreferenceChanged?.(
      state.selectedKinId,
      state.selectedKinVoice.soundscape || { enabled: false }
    );
    state.voiceError = null;
    elements.monitorLine.textContent = "Audio settings saved.";
  } catch (error) {
    state.voiceError = errorMessage(error);
  } finally {
    state.voiceSaving = false;
    renderActivity();
  }
}

export async function saveSelectedKinAmbient(context: VoiceHermesContext): Promise<void> {
  const { state, elements, api, renderActivity } = context;
  if (!state.selectedKinId) {
    return;
  }

  const enabled = elements.ambientContextEnabledInput.checked;
  const chatDynamism = readChatDynamismPreferenceForm(elements);

  state.ambientSaving = true;
  renderActivity();
  try {
    const saved = await api.setKinAmbientPreference({
      kinId: state.selectedKinId,
      enabled,
      chatDynamism
    });
    state.selectedKinAmbient = saved;
    state.subscriptions = state.subscriptions.map((subscription) =>
      subscription.kin?.aiId === state.selectedKinId
        ? {
            ...subscription,
            ambientContextEnabled: saved.enabled,
            chatDynamism: saved.chatDynamism
          }
        : subscription
    );
    state.ambientError = null;
    elements.monitorLine.textContent = "Hermes settings saved.";
  } catch (error) {
    state.ambientError = errorMessage(error);
  } finally {
    state.ambientSaving = false;
    renderActivity();
  }
}

export function syncChatDynamismRangeLabels(context: VoiceHermesContext): void {
  const { elements, chatDynamismSlider } = context;
  const min = Number(elements.chatDynamismMinInput.value);
  const max = Number(elements.chatDynamismMaxInput.value);
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  elements.chatDynamismMinValue.textContent = lower.toFixed(2);
  elements.chatDynamismMaxValue.textContent = upper.toFixed(2);

  const sliderMin = Number(elements.chatDynamismMinInput.min || chatDynamismSlider.hardMin);
  const sliderMax = Number(elements.chatDynamismMinInput.max || chatDynamismSlider.hardMax);
  const span = sliderMax - sliderMin || 1;
  const start = ((lower - sliderMin) / span) * 100;
  const end = ((upper - sliderMin) / span) * 100;
  const softLow = ((chatDynamismSlider.practicalMin - sliderMin) / span) * 100;
  const softHigh = ((chatDynamismSlider.practicalMax - sliderMin) / span) * 100;
  elements.chatDynamismRangeControl.style.setProperty("--range-start", `${start}%`);
  elements.chatDynamismRangeControl.style.setProperty("--range-end", `${end}%`);
  elements.chatDynamismRangeControl.style.setProperty("--soft-low", `${softLow}%`);
  elements.chatDynamismRangeControl.style.setProperty("--soft-high", `${softHigh}%`);
}

function showFormPanel(elements: VoiceHermesElements, panel: "voice" | "hermes"): void {
  elements.kinDetailEmpty.hidden = true;
  elements.kinDetailContent.hidden = false;
  elements.kinDetailContent.classList.remove("app-settings-content");
  elements.kinDetailContent.classList.add("form-detail-content");
  elements.fieldContent.hidden = true;
  elements.journalSuggestionPanel.hidden = true;
  elements.appSettingsForm.hidden = true;
  elements.voiceForm.hidden = panel !== "voice";
  elements.groupAudioPanel.hidden = true;
  elements.kinHermesForm.hidden = panel !== "hermes";
  elements.kinAnalyzePanel.hidden = true;
  elements.chatExportPanel.hidden = true;
  elements.timeline.hidden = true;
}

function renderKinHermesStats(
  context: VoiceHermesContext,
  selectedKin: KinSummary | null,
  preference: KinAmbientPreferenceResult
): void {
  const current: ChatDynamismValue = preference.currentChatDynamism || {};
  const chatDynamism: Partial<KinChatDynamismPreference> = preference.chatDynamism || {};
  renderStats(context.elements.detailStats, [
    { label: "Kin", value: selectedKin?.name || context.state.selectedKinId || "Unknown" },
    { label: "Ambient", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Dynamism", value: current.display || "Unknown" },
    { label: "Drift", value: chatDynamism.enabled ? `${chatDynamism.min} - ${chatDynamism.max}` : "Off" }
  ]);
}

function renderVoiceStats(
  context: VoiceHermesContext,
  selectedKin: KinSummary | null,
  preference: KinVoicePreference
): void {
  const providers = context.state.selectedKinVoice?.configuredProviders || {};
  const provider = preference.provider || "";
  renderStats(context.elements.detailStats, [
    { label: "Kin", value: selectedKin?.name || context.state.selectedKinId || "Unknown" },
    { label: "Voice", value: preference.enabled ? "Enabled" : "Off" },
    { label: "Soundscape", value: context.state.selectedKinVoice?.soundscape?.enabled ? "Enabled" : "Off" },
    { label: "Provider", value: providerLabel(provider) },
    {
      label: "Ready",
      value: context.state.selectedKinVoice?.globalEnabled && providers[provider] ? "Yes" : "No"
    }
  ]);
}

function renderOpenAiVoiceOptions(elements: VoiceHermesElements, options: string[], selectedVoice: string): void {
  const values = options.length > 0 ? options : [selectedVoice || "marin"];
  elements.openAiVoiceInput.replaceChildren();
  for (const voice of values) {
    const option = document.createElement("option");
    option.value = voice;
    option.textContent = voice;
    elements.openAiVoiceInput.append(option);
  }
  elements.openAiVoiceInput.value = selectedVoice || values[0] || "marin";
}

function renderVoiceStatusLine(context: VoiceHermesContext): void {
  const { state, elements } = context;
  if (!state.selectedKinVoice?.ok) {
    elements.voiceStatusLine.textContent = "";
    return;
  }

  const provider = elements.voiceProviderInput.value;
  const providers = state.selectedKinVoice.configuredProviders || {};
  if (!state.selectedKinVoice.globalEnabled) {
    elements.voiceStatusLine.textContent = "Voice is off globally. This Kin setting is saved but will not play yet.";
    return;
  }

  if (!providers[provider]) {
    elements.voiceStatusLine.textContent =
      provider === "openai" ? "OpenAI is missing an API key." : "ElevenLabs is missing an API key.";
    return;
  }

  if (provider === "elevenlabs" && !elements.elevenLabsVoiceInput.value.trim()) {
    elements.voiceStatusLine.textContent = "ElevenLabs requires a voice ID for this Kin.";
    return;
  }

  elements.voiceStatusLine.textContent = "Voice settings are ready for this Kin.";
}

function renderSoundscapeStatusLine(context: VoiceHermesContext): void {
  const { state, elements } = context;
  const enabled = Boolean(state.selectedKinVoice?.soundscape?.enabled);
  elements.soundscapeStatusLine.textContent = enabled
    ? "Hermes may generate local ambience when this Kin is active."
    : "Hermes soundscape is disabled for this Kin.";
}

function readChatDynamismPreferenceForm(elements: VoiceHermesElements): KinChatDynamismPreference {
  const min = Number(elements.chatDynamismMinInput.value);
  const max = Number(elements.chatDynamismMaxInput.value);
  return {
    enabled: elements.chatDynamismEnabledInput.checked,
    min: Math.min(min, max),
    max: Math.max(min, max)
  };
}

function chatDynamismCurrentLabel(value?: ChatDynamismValue | null): string {
  if (!value) {
    return "Unknown";
  }

  const base = value.display || (typeof value.numeric === "number" ? value.numeric.toFixed(2) : "Unknown");
  return typeof value.numeric === "number" ? `${base} (${value.numeric.toFixed(2)})` : base;
}

function hermesStatusLine(preference: KinAmbientPreferenceResult): string {
  const ambient = preference.enabled ? "Ambient context is allowed" : "Ambient context is disabled";
  const chatDynamism = preference.chatDynamism?.enabled
    ? `Chat Dynamism drift suggestions are allowed from ${preference.chatDynamism.min} to ${preference.chatDynamism.max}.`
    : "Chat Dynamism drift suggestions are disabled.";
  return `${ambient}. ${chatDynamism}`;
}

function renderStats(container: HTMLElement, stats: Array<{ label: string; value: string }>): void {
  container.replaceChildren();
  for (const stat of stats) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = stat.label;
    const value = document.createElement("strong");
    value.textContent = stat.value;
    item.append(label, value);
    container.append(item);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
