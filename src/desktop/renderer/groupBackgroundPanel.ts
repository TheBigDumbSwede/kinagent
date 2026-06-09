import type { GroupBackgroundSettings, GroupBackgroundSuggestionSummary, GroupSummary } from "./rendererTypes.js";

export interface GroupBackgroundPanelState {
  selectedGroupId: string | null;
  groups: GroupSummary[];
  groupBackgroundSuggestions: GroupBackgroundSuggestionSummary[];
  groupBackgroundSettings: GroupBackgroundSettings;
  groupBackgroundForceSaving: boolean;
  groupBackgroundSettingsSaving: boolean;
  groupBackgroundSavingId: string | null;
  groupBackgroundSavingAction: "generate" | "apply" | "dismiss" | null;
  groupBackgroundError: string | null;
}

export interface GroupBackgroundPanelElements {
  groupBackgroundEnabledInput: HTMLInputElement;
  groupBackgroundAutonomousInput: HTMLInputElement;
  groupBackgroundStatusLine: HTMLElement;
  groupBackgroundActions: HTMLElement;
  groupBackgroundSuggestionList: HTMLElement;
}

export interface GroupBackgroundPanelContext {
  state: GroupBackgroundPanelState;
  elements: GroupBackgroundPanelElements;
  onSettingsChanged: (settings: GroupBackgroundSettings) => void;
  onForcePrewarm: () => void;
  onGenerateImage: (id: string) => void;
  onApplyImage: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}

export function renderGroupBackgroundPanel(context: GroupBackgroundPanelContext, selectedGroup: GroupSummary): void {
  const { state, elements } = context;
  const suggestions = selectedGroupBackgroundSuggestions(state);
  elements.groupBackgroundSuggestionList.replaceChildren();
  elements.groupBackgroundEnabledInput.checked = state.groupBackgroundSettings.enabled;
  elements.groupBackgroundEnabledInput.disabled = state.groupBackgroundSettingsSaving;
  elements.groupBackgroundAutonomousInput.checked =
    state.groupBackgroundSettings.enabled && state.groupBackgroundSettings.autonomous;
  elements.groupBackgroundAutonomousInput.disabled =
    state.groupBackgroundSettingsSaving || !state.groupBackgroundSettings.enabled;
  elements.groupBackgroundEnabledInput.onchange = () => {
    context.onSettingsChanged({
      enabled: elements.groupBackgroundEnabledInput.checked,
      autonomous: elements.groupBackgroundEnabledInput.checked && elements.groupBackgroundAutonomousInput.checked
    });
  };
  elements.groupBackgroundAutonomousInput.onchange = () => {
    context.onSettingsChanged({
      enabled: elements.groupBackgroundEnabledInput.checked,
      autonomous: elements.groupBackgroundEnabledInput.checked && elements.groupBackgroundAutonomousInput.checked
    });
  };
  elements.groupBackgroundActions.replaceChildren(createForcePrewarmButton(context));
  elements.groupBackgroundStatusLine.textContent = !state.groupBackgroundSettings.enabled
    ? "Background proposals are disabled."
    : state.groupBackgroundSettings.autonomous
      ? "Autonomous background updates are enabled."
      : suggestions.length > 0
        ? `${suggestions.length} reviewed background prompt ${suggestions.length === 1 ? "proposal" : "proposals"} ready.`
        : "No background prompt proposals for this Group yet.";

  if (state.groupBackgroundError) {
    const error = document.createElement("p");
    error.className = "panel-note";
    error.textContent = state.groupBackgroundError;
    elements.groupBackgroundSuggestionList.append(error);
  }

  if (suggestions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-note";
    empty.textContent = `Hermes can propose image prompts for ${selectedGroup.name || "this Group"} when a scene shift is significant.`;
    elements.groupBackgroundSuggestionList.append(empty);
    return;
  }

  for (const suggestion of suggestions) {
    elements.groupBackgroundSuggestionList.append(createSuggestionElement(context, suggestion));
  }
}

export function selectedGroupBackgroundSuggestions(
  state: GroupBackgroundPanelState
): GroupBackgroundSuggestionSummary[] {
  if (!state.selectedGroupId) {
    return [];
  }

  return state.groupBackgroundSuggestions.filter((suggestion) => suggestion.groupId === state.selectedGroupId);
}

export function upsertGroupBackgroundSuggestion(
  state: GroupBackgroundPanelState,
  suggestion: GroupBackgroundSuggestionSummary | null | undefined
): void {
  if (!suggestion?.id) {
    return;
  }

  state.groupBackgroundSuggestions = [
    suggestion,
    ...state.groupBackgroundSuggestions.filter((current) => current.id !== suggestion.id)
  ];
}

export function groupBackgroundSuggestionNotice(
  state: Pick<GroupBackgroundPanelState, "groups">,
  suggestion: GroupBackgroundSuggestionSummary | null | undefined
): string {
  const group = state.groups.find((item) => item.groupId === suggestion?.groupId);
  return `Background prompt proposal ready for ${group?.name || suggestion?.groupId || "Group"}.`;
}

function createSuggestionElement(
  context: GroupBackgroundPanelContext,
  suggestion: GroupBackgroundSuggestionSummary
): HTMLElement {
  const item = document.createElement("article");
  item.className = "journal-suggestion background-suggestion";

  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.className = "journal-suggestion-heading";
  const title = document.createElement("strong");
  title.textContent = suggestion.title || "Background prompt proposal";
  const meta = document.createElement("div");
  meta.className = "journal-suggestion-meta";
  appendBadge(meta, `Significance ${Math.round((suggestion.significance || 0) * 100)}%`);
  if (suggestion.visualStyle) {
    appendBadge(meta, suggestion.visualStyle);
  }
  heading.append(title, meta);
  const date = document.createElement("span");
  date.textContent = formatTime(suggestion.createdAt);
  header.append(heading, date);

  const prompt = document.createElement("p");
  prompt.textContent = suggestion.prompt;

  const image = createGeneratedImageElement(suggestion);
  const details = document.createElement("dl");
  if (suggestion.generatedImage) {
    appendDetail(details, "Image", `${suggestion.generatedImage.model} · ${suggestion.generatedImage.size}`);
  }
  appendDetail(details, "Kindroid background", suggestion.appliedBackgroundPath ? "Applied" : undefined);
  appendDetail(details, "Reason", suggestion.reason);
  appendDetail(details, "Current setting", suggestion.targetCurrentScene);
  appendDetail(details, "Scene summary", suggestion.sceneSummary);
  appendDetail(details, "Negative prompt", suggestion.negativePrompt);
  appendListDetail(details, "Evidence", suggestion.evidence || []);

  if (suggestion.generationError) {
    const generationError = document.createElement("p");
    generationError.className = "panel-note";
    generationError.textContent = `Image generation failed: ${suggestion.generationError}`;
    details.append(generationError);
  }
  if (suggestion.applyError) {
    const applyError = document.createElement("p");
    applyError.className = "panel-note";
    applyError.textContent = `Kindroid apply failed: ${suggestion.applyError}`;
    details.append(applyError);
  }

  const actions = document.createElement("div");
  actions.className = "journal-suggestion-actions";
  const savingAction =
    context.state.groupBackgroundSavingId === suggestion.id ? context.state.groupBackgroundSavingAction : null;
  const generate = document.createElement("button");
  generate.type = "button";
  generate.className = "secondary";
  generate.textContent =
    savingAction === "generate" ? "Generating" : suggestion.generatedImage ? "Regenerate Image" : "Generate Image";
  generate.disabled = Boolean(context.state.groupBackgroundSavingId);
  generate.addEventListener("click", () => context.onGenerateImage(suggestion.id));
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "secondary";
  apply.textContent =
    savingAction === "apply" ? "Applying" : suggestion.appliedBackgroundPath ? "Apply Again" : "Apply to Kindroid";
  apply.disabled = Boolean(context.state.groupBackgroundSavingId) || !suggestion.generatedImage?.path;
  apply.addEventListener("click", () => context.onApplyImage(suggestion.id));
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = savingAction === "dismiss" ? "Dismissing" : "Dismiss";
  dismiss.disabled = Boolean(context.state.groupBackgroundSavingId);
  dismiss.addEventListener("click", () => context.onDismissSuggestion(suggestion.id));
  actions.append(generate, apply, dismiss);

  item.append(header, prompt);
  if (image) {
    item.append(image);
  }
  item.append(details, actions);
  return item;
}

function createForcePrewarmButton(context: GroupBackgroundPanelContext): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact";
  button.textContent = context.state.groupBackgroundForceSaving ? "Prewarming" : "Force Prewarm";
  button.disabled =
    context.state.groupBackgroundForceSaving ||
    context.state.groupBackgroundSettingsSaving ||
    !context.state.groupBackgroundSettings.enabled ||
    !context.state.selectedGroupId;
  button.addEventListener("click", () => context.onForcePrewarm());
  return button;
}

function createGeneratedImageElement(suggestion: GroupBackgroundSuggestionSummary): HTMLElement | null {
  if (!suggestion.generatedImage?.path) {
    return null;
  }

  const figure = document.createElement("figure");
  figure.className = "background-image-preview";
  const image = document.createElement("img");
  image.src = fileUrlFromPath(suggestion.generatedImage.path, suggestion.generatedImage.generatedAt);
  image.alt = suggestion.title || "Generated group background";
  figure.append(image);
  return figure;
}

function fileUrlFromPath(filePath: string, cacheKey?: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const suffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  if (/^[A-Za-z]:\//.test(normalized)) {
    const [drive, ...parts] = normalized.split("/");
    return `file:///${drive}/${parts.map((part) => encodeURIComponent(part)).join("/")}${suffix}`;
  }
  return `file://${normalized}${suffix}`;
}

function appendBadge(container: HTMLElement, label: string): void {
  if (!label) {
    return;
  }

  const badge = document.createElement("span");
  badge.className = "journal-suggestion-badge";
  badge.textContent = label;
  container.append(badge);
}

function appendDetail(list: HTMLElement, label: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  list.append(term, detail);
}

function appendListDetail(list: HTMLElement, label: string, values: unknown[]): void {
  const visibleValues = values.map((value) => String(value).trim()).filter(Boolean);
  if (visibleValues.length === 0) {
    return;
  }

  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  const valueList = document.createElement("ul");
  for (const value of visibleValues) {
    const item = document.createElement("li");
    item.textContent = value;
    valueList.append(item);
  }
  detail.append(valueList);
  list.append(term, detail);
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
