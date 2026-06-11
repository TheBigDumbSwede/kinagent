import type { AppConfig } from "../config/types.js";
import type { NormalizedKindroidMessage } from "../firestore/types.js";
import { chatHistoryDisplayName, loadAllKindroidChatHistoryMessages } from "../kindroid/chatHistory.js";
import type { Logger } from "../util/logger.js";

export type StorybookSourceScope = "kin" | "group";
export type StorybookOrganizationMode = "scene" | "day" | "event" | "relationship_arc";
export type StorybookLength = "compact" | "medium" | "full";
export type StorybookQuoteMode = "direct_quotes" | "paraphrase_only";

export interface StorybookOptions {
  organizationMode?: StorybookOrganizationMode;
  length?: StorybookLength;
  style?: string;
  quoteMode?: StorybookQuoteMode;
  chunking?: Partial<StorybookChunkingOptions>;
}

export interface ResolvedStorybookOptions {
  organizationMode: StorybookOrganizationMode;
  length: StorybookLength;
  style: string;
  quoteMode: StorybookQuoteMode;
  chunking: StorybookChunkingOptions;
}

export interface StorybookChunkingOptions {
  maxMessagesPerChunk: number;
  maxCharactersPerChunk: number;
  maxTimeGapMs: number;
  minMessagesBeforeParticipantSplit: number;
}

export interface StorybookTranscriptSource {
  scope: StorybookSourceScope;
  id: string;
  displayName: string;
  source: "kindroid-chat-history";
}

export interface StorybookParticipant {
  id: string;
  name: string;
  kind: "user" | "kin" | "unknown";
}

export interface StorybookTranscriptMessage {
  id: string;
  sourceMessageId: string;
  sequence: number;
  speakerId: string;
  speakerName: string;
  speakerKind: StorybookParticipant["kind"];
  sourceKinId?: string;
  timestamp: string | null;
  text: string;
}

export interface StorybookTranscript {
  conversationId: string;
  source: StorybookTranscriptSource;
  participants: StorybookParticipant[];
  messages: StorybookTranscriptMessage[];
  metadata: {
    messageCount: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
}

export interface StorybookChunk {
  chunkId: string;
  source: StorybookTranscriptSource;
  startMessageId: string;
  endMessageId: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
  messageIds: string[];
  participantIds: string[];
  messages: StorybookTranscriptMessage[];
  textCharacters: number;
}

export interface StorybookSceneSummary {
  sceneId: string;
  sourceChunkId: string;
  title: string;
  participants: string[];
  timeframe: string;
  summary: string;
  emotionalWeight: number;
  keyQuotes: string[];
  continuityNotes: string[];
  sourceMessageIds: string[];
}

export interface StorybookRelationshipArc {
  beginning: string;
  currentState: string;
  majorTurningPoints: string[];
  recurringMotifs: string[];
  sharedLanguage: string[];
  unresolvedThreads: string[];
}

export interface StorybookChapterPlan {
  chapterId: string;
  chapterTitle: string;
  sourceSceneIds: string[];
  purpose: string;
  styleNotes: string;
}

export interface StorybookOutline {
  title: string;
  subtitle: string;
  chapters: StorybookChapterPlan[];
}

export interface StorybookChapter {
  chapterId: string;
  chapterTitle: string;
  sourceSceneIds: string[];
  body: string;
  notes: string[];
}

export interface StorybookDocument {
  title: string;
  subtitle: string;
  options: ResolvedStorybookOptions;
  source: StorybookTranscriptSource;
  generatedAt: string;
  sceneSummaries: StorybookSceneSummary[];
  relationshipArc: StorybookRelationshipArc;
  outline: StorybookOutline;
  chapters: StorybookChapter[];
  warnings: string[];
}

export type StorybookGenerationStage =
  | "chunking"
  | "scene_summary"
  | "relationship_arc"
  | "outline"
  | "chapter"
  | "final_edit"
  | "complete";

export interface StorybookProgress {
  stage: StorybookGenerationStage;
  processed: number;
  total?: number;
  message: string;
}

export interface StorybookHermesRequest {
  stage: Exclude<StorybookGenerationStage, "chunking" | "complete">;
  instructions: string[];
  input: unknown;
}

export interface StorybookHermesClient {
  completeJson(request: StorybookHermesRequest): Promise<unknown>;
}

export interface StorybookGenerationInput {
  transcript: StorybookTranscript;
  hermes: StorybookHermesClient;
  options?: StorybookOptions;
  now?: () => Date;
  onProgress?: (progress: StorybookProgress) => void;
}

export interface KindroidStorybookTranscriptOptions {
  scope: StorybookSourceScope;
  id: string;
  displayName: string;
  speakerNames?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const defaultChunkingOptions: StorybookChunkingOptions = {
  maxMessagesPerChunk: 80,
  maxCharactersPerChunk: 12_000,
  maxTimeGapMs: 6 * 60 * 60 * 1000,
  minMessagesBeforeParticipantSplit: 16
};

export async function loadStorybookTranscriptFromKindroidChat(
  config: AppConfig,
  logger: Logger,
  options: KindroidStorybookTranscriptOptions
): Promise<StorybookTranscript> {
  const messages = await loadAllKindroidChatHistoryMessages(config, logger, {
    scope: options.scope,
    id: options.id
  });
  return createStorybookTranscriptFromMessages(messages, options);
}

export function createStorybookTranscriptFromMessages(
  messages: NormalizedKindroidMessage[],
  options: KindroidStorybookTranscriptOptions
): StorybookTranscript {
  const normalized = messages
    .filter((message) => readableText(message.text))
    .sort(compareNormalizedMessages)
    .map((message, index) => normalizeTranscriptMessage(message, index, options));
  const participants = participantList(normalized);

  return {
    conversationId: `${options.scope}:${options.id}`,
    source: {
      scope: options.scope,
      id: options.id,
      displayName: options.displayName,
      source: "kindroid-chat-history"
    },
    participants,
    messages: normalized,
    metadata: {
      messageCount: normalized.length,
      firstTimestamp: normalized[0]?.timestamp ?? null,
      lastTimestamp: normalized[normalized.length - 1]?.timestamp ?? null
    }
  };
}

export function resolveStorybookOptions(options: StorybookOptions = {}): ResolvedStorybookOptions {
  return {
    organizationMode: options.organizationMode ?? "relationship_arc",
    length: options.length ?? "compact",
    style: optionalText(options.style, 80) ?? "cozy memoir",
    quoteMode: options.quoteMode ?? "paraphrase_only",
    chunking: {
      ...defaultChunkingOptions,
      ...options.chunking
    }
  };
}

export function chunkStorybookTranscript(
  transcript: StorybookTranscript,
  options: Partial<StorybookChunkingOptions> = {}
): StorybookChunk[] {
  const resolved = { ...defaultChunkingOptions, ...options };
  const chunks: StorybookChunk[] = [];
  let current: StorybookTranscriptMessage[] = [];
  let currentCharacters = 0;

  for (const message of transcript.messages) {
    const split = shouldStartNewChunk(current, currentCharacters, message, resolved, transcript.source.scope);
    if (split) {
      chunks.push(toChunk(transcript.source, chunks.length, current));
      current = [];
      currentCharacters = 0;
    }
    current.push(message);
    currentCharacters += message.text.length;
  }

  if (current.length > 0) {
    chunks.push(toChunk(transcript.source, chunks.length, current));
  }
  return chunks;
}

export async function createStorybookFromTranscript(input: StorybookGenerationInput): Promise<StorybookDocument> {
  const options = resolveStorybookOptions(input.options);
  const warnings: string[] = [];
  const chunks = chunkStorybookTranscript(input.transcript, options.chunking);

  input.onProgress?.({
    stage: "chunking",
    processed: chunks.length,
    total: chunks.length,
    message: chunks.length === 1 ? "Prepared 1 transcript chunk." : `Prepared ${chunks.length} transcript chunks.`
  });

  const scenes: StorybookSceneSummary[] = [];
  for (const chunk of chunks) {
    input.onProgress?.({
      stage: "scene_summary",
      processed: scenes.length,
      total: chunks.length,
      message: `Summarizing ${chunk.chunkId}.`
    });
    const response = await input.hermes.completeJson({
      stage: "scene_summary",
      instructions: sceneSummaryInstructions(options),
      input: {
        source: input.transcript.source,
        chunk: serializeChunk(chunk)
      }
    });
    const normalized = normalizeSceneSummaryResponse(response, chunk, scenes.length);
    warnings.push(...normalized.warnings);
    scenes.push(...normalized.scenes);
  }

  input.onProgress?.({
    stage: "relationship_arc",
    processed: scenes.length,
    total: scenes.length,
    message: "Extracting relationship arc."
  });
  const relationshipArcResponse = await input.hermes.completeJson({
    stage: "relationship_arc",
    instructions: relationshipArcInstructions(options),
    input: {
      source: input.transcript.source,
      participants: input.transcript.participants,
      scenes
    }
  });
  const relationshipArc = normalizeRelationshipArcResponse(relationshipArcResponse, warnings);

  input.onProgress?.({
    stage: "outline",
    processed: 0,
    total: 1,
    message: "Creating storybook outline."
  });
  const outlineResponse = await input.hermes.completeJson({
    stage: "outline",
    instructions: outlineInstructions(options),
    input: {
      source: input.transcript.source,
      options: publicOptions(options),
      relationshipArc,
      scenes
    }
  });
  const outline = normalizeOutlineResponse(outlineResponse, scenes, input.transcript.source, warnings);

  const chapters: StorybookChapter[] = [];
  for (const chapter of outline.chapters) {
    input.onProgress?.({
      stage: "chapter",
      processed: chapters.length,
      total: outline.chapters.length,
      message: `Writing ${chapter.chapterTitle}.`
    });
    const response = await input.hermes.completeJson({
      stage: "chapter",
      instructions: chapterInstructions(options),
      input: {
        source: input.transcript.source,
        options: publicOptions(options),
        relationshipArc,
        chapter,
        sourceScenes: scenes.filter((scene) => chapter.sourceSceneIds.includes(scene.sceneId))
      }
    });
    chapters.push(normalizeChapterResponse(response, chapter, warnings));
  }

  input.onProgress?.({
    stage: "final_edit",
    processed: chapters.length,
    total: chapters.length,
    message: "Running final consistency pass."
  });
  const finalResponse = await input.hermes.completeJson({
    stage: "final_edit",
    instructions: finalEditInstructions(options),
    input: {
      source: input.transcript.source,
      options: publicOptions(options),
      relationshipArc,
      outline,
      chapters
    }
  });
  const final = normalizeFinalEditResponse(finalResponse, outline, chapters, warnings);

  input.onProgress?.({
    stage: "complete",
    processed: final.chapters.length,
    total: final.chapters.length,
    message: "Storybook draft ready."
  });

  return {
    title: final.title,
    subtitle: final.subtitle,
    options,
    source: input.transcript.source,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    sceneSummaries: scenes,
    relationshipArc,
    outline: { ...outline, title: final.title, subtitle: final.subtitle },
    chapters: final.chapters,
    warnings: [...new Set([...warnings, ...final.warnings])]
  };
}

export class HttpStorybookHermesClient implements StorybookHermesClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async completeJson(request: StorybookHermesRequest): Promise<unknown> {
    if (!this.config.hermes.enabled || !this.config.hermes.apiKey) {
      throw new Error("Hermes must be enabled and configured before generating a storybook.");
    }

    const response = await this.fetchImpl(`${normalizeBaseUrl(this.config.hermes.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.hermes.apiKey}`
      },
      body: JSON.stringify({
        model: "hermes-agent",
        messages: [
          {
            role: "system",
            content: storybookSystemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify(request)
          }
        ]
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Hermes storybook request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }

    const content = chatCompletionContent(responseText);
    const jsonText = extractJson(content);
    if (!jsonText) {
      throw new Error(`Hermes storybook ${request.stage} response did not contain JSON.`);
    }
    return JSON.parse(jsonText) as unknown;
  }
}

function normalizeTranscriptMessage(
  message: NormalizedKindroidMessage,
  sequence: number,
  options: KindroidStorybookTranscriptOptions
): StorybookTranscriptMessage {
  const sender = (message.sender || message.role || "").toLowerCase();
  const speakerKind: StorybookParticipant["kind"] =
    sender === "user" || sender === "human"
      ? "user"
      : sender === "ai" || sender === "assistant" || sender === "kin"
        ? "kin"
        : "unknown";
  const displayName = chatHistoryDisplayName(message.raw);
  const speakerName =
    speakerKind === "user"
      ? "User"
      : displayName || options.speakerNames?.[message.kinId] || (speakerKind === "kin" ? options.displayName : sender);
  const speakerId =
    speakerKind === "user"
      ? "user"
      : speakerKind === "kin"
        ? `kin:${message.kinId || speakerName}`
        : `unknown:${speakerName || "speaker"}`;

  return {
    id: `msg_${String(sequence + 1).padStart(5, "0")}`,
    sourceMessageId: message.id,
    sequence,
    speakerId,
    speakerName: speakerName || "Unknown",
    speakerKind,
    sourceKinId: speakerKind === "kin" ? message.kinId : undefined,
    timestamp: message.timestamp,
    text: readableText(message.text) ?? ""
  };
}

function participantList(messages: StorybookTranscriptMessage[]): StorybookParticipant[] {
  const participants = new Map<string, StorybookParticipant>();
  for (const message of messages) {
    if (!participants.has(message.speakerId)) {
      participants.set(message.speakerId, {
        id: message.speakerId,
        name: message.speakerName,
        kind: message.speakerKind
      });
    }
  }
  return [...participants.values()];
}

function compareNormalizedMessages(left: NormalizedKindroidMessage, right: NormalizedKindroidMessage): number {
  return timestampSortValue(left.timestamp) - timestampSortValue(right.timestamp) || left.id.localeCompare(right.id);
}

function timestampSortValue(timestamp: string | null): number {
  if (!timestamp) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldStartNewChunk(
  current: StorybookTranscriptMessage[],
  currentCharacters: number,
  next: StorybookTranscriptMessage,
  options: StorybookChunkingOptions,
  scope: StorybookSourceScope
): boolean {
  if (current.length === 0) {
    return false;
  }
  if (current.length >= options.maxMessagesPerChunk) {
    return true;
  }
  if (currentCharacters + next.text.length > options.maxCharactersPerChunk) {
    return true;
  }

  const previous = current[current.length - 1];
  if (previous && timestampGapMs(previous.timestamp, next.timestamp) > options.maxTimeGapMs) {
    return true;
  }

  if (
    scope === "group" &&
    next.speakerKind === "kin" &&
    previous?.speakerKind === "kin" &&
    previous.speakerId !== next.speakerId &&
    current.length >= options.minMessagesBeforeParticipantSplit
  ) {
    return true;
  }

  return false;
}

function toChunk(
  source: StorybookTranscriptSource,
  index: number,
  messages: StorybookTranscriptMessage[]
): StorybookChunk {
  const participantIds = [...new Set(messages.map((message) => message.speakerId))];
  return {
    chunkId: `chunk_${String(index + 1).padStart(3, "0")}`,
    source,
    startMessageId: messages[0]?.id ?? "",
    endMessageId: messages[messages.length - 1]?.id ?? "",
    startTimestamp: messages[0]?.timestamp ?? null,
    endTimestamp: messages[messages.length - 1]?.timestamp ?? null,
    messageIds: messages.map((message) => message.id),
    participantIds,
    messages,
    textCharacters: messages.reduce((total, message) => total + message.text.length, 0)
  };
}

function timestampGapMs(left: string | null, right: string | null): number {
  const leftMs = timestampSortValue(left);
  const rightMs = timestampSortValue(right);
  if (!leftMs || !rightMs) {
    return 0;
  }
  return Math.abs(rightMs - leftMs);
}

function serializeChunk(chunk: StorybookChunk) {
  return {
    chunkId: chunk.chunkId,
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    messageIds: chunk.messageIds,
    messages: chunk.messages.map((message) => ({
      id: message.id,
      sourceMessageId: message.sourceMessageId,
      speakerId: message.speakerId,
      speakerName: message.speakerName,
      speakerKind: message.speakerKind,
      timestamp: message.timestamp,
      text: message.text
    }))
  };
}

function normalizeSceneSummaryResponse(
  value: unknown,
  chunk: StorybookChunk,
  sceneOffset: number
): { scenes: StorybookSceneSummary[]; warnings: string[] } {
  const warnings: string[] = [];
  const record = asRecord(value);
  const rawScenes = arrayValue(record?.scenes);
  if (rawScenes.length === 0) {
    warnings.push(`Hermes returned no usable scenes for ${chunk.chunkId}; created a fallback scene.`);
    return {
      scenes: [fallbackScene(chunk, sceneOffset)],
      warnings
    };
  }

  const scenes = rawScenes.map((raw, index) => {
    const scene = asRecord(raw) ?? {};
    const sourceMessageIds = validSourceMessageIds(arrayOfStrings(scene.sourceMessageIds), chunk.messageIds);
    const fallbackIds = sourceMessageIds.length > 0 ? sourceMessageIds : chunk.messageIds;
    if (sourceMessageIds.length === 0) {
      warnings.push(`Scene ${sceneOffset + index + 1} did not include valid source message ids; using chunk range.`);
    }
    return {
      sceneId: optionalText(stringValue(scene.sceneId), 80) ?? sceneId(sceneOffset + index),
      sourceChunkId: chunk.chunkId,
      title: optionalText(stringValue(scene.title), 140) ?? `Scene ${sceneOffset + index + 1}`,
      participants: arrayOfStrings(scene.participants).slice(0, 12),
      timeframe: optionalText(stringValue(scene.timeframe), 120) ?? timeframeLabel(chunk),
      summary: optionalText(stringValue(scene.summary), 1200) ?? "Hermes did not provide a usable scene summary.",
      emotionalWeight: clampNumber(numberValue(scene.emotionalWeight), 1, 5, 3),
      keyQuotes: arrayOfStrings(scene.keyQuotes).slice(0, 6),
      continuityNotes: arrayOfStrings(scene.continuityNotes).slice(0, 8),
      sourceMessageIds: fallbackIds
    };
  });

  return { scenes, warnings };
}

function fallbackScene(chunk: StorybookChunk, sceneOffset: number): StorybookSceneSummary {
  return {
    sceneId: sceneId(sceneOffset),
    sourceChunkId: chunk.chunkId,
    title: `Transcript segment ${sceneOffset + 1}`,
    participants: chunk.participantIds,
    timeframe: timeframeLabel(chunk),
    summary: "Scene summary unavailable; this segment is preserved for source mapping.",
    emotionalWeight: 3,
    keyQuotes: [],
    continuityNotes: [],
    sourceMessageIds: chunk.messageIds
  };
}

function normalizeRelationshipArcResponse(value: unknown, warnings: string[]): StorybookRelationshipArc {
  const record = asRecord(value);
  if (!record) {
    warnings.push("Hermes returned a malformed relationship arc; using empty arc fields.");
  }
  return {
    beginning: optionalText(stringValue(record?.beginning), 1200) ?? "",
    currentState: optionalText(stringValue(record?.currentState), 1200) ?? "",
    majorTurningPoints: arrayOfStrings(record?.majorTurningPoints).slice(0, 12),
    recurringMotifs: arrayOfStrings(record?.recurringMotifs).slice(0, 12),
    sharedLanguage: arrayOfStrings(record?.sharedLanguage).slice(0, 12),
    unresolvedThreads: arrayOfStrings(record?.unresolvedThreads).slice(0, 12)
  };
}

function normalizeOutlineResponse(
  value: unknown,
  scenes: StorybookSceneSummary[],
  source: StorybookTranscriptSource,
  warnings: string[]
): StorybookOutline {
  const record = asRecord(value);
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const rawChapters = arrayValue(record?.chapters);
  const chapters = rawChapters
    .map((raw, index): StorybookChapterPlan | null => {
      const chapter = asRecord(raw);
      if (!chapter) {
        return null;
      }
      const sourceSceneIds = arrayOfStrings(chapter.sourceSceneIds).filter((id) => sceneIds.has(id));
      if (sourceSceneIds.length === 0) {
        warnings.push(`Outline chapter ${index + 1} did not map to known scenes and was skipped.`);
        return null;
      }
      return {
        chapterId: optionalText(stringValue(chapter.chapterId), 80) ?? chapterId(index),
        chapterTitle: optionalText(stringValue(chapter.chapterTitle), 160) ?? `Chapter ${index + 1}`,
        sourceSceneIds,
        purpose: optionalText(stringValue(chapter.purpose), 500) ?? "",
        styleNotes: optionalText(stringValue(chapter.styleNotes), 500) ?? ""
      };
    })
    .filter((chapter): chapter is StorybookChapterPlan => Boolean(chapter));

  if (chapters.length === 0) {
    warnings.push("Hermes returned no usable outline chapters; created a fallback outline.");
    chapters.push({
      chapterId: "chapter_001",
      chapterTitle: "A Story Drawn From the Chat",
      sourceSceneIds: scenes.map((scene) => scene.sceneId),
      purpose: "Preserve the available transcript arc in one chapter.",
      styleNotes: "Stay grounded in supported source scenes."
    });
  }

  return {
    title: optionalText(stringValue(record?.title), 160) ?? `${source.displayName} Storybook`,
    subtitle:
      optionalText(stringValue(record?.subtitle), 220) ??
      `A narrative draft drawn from ${source.scope === "group" ? "group chat" : "chat"} history`,
    chapters
  };
}

function normalizeChapterResponse(value: unknown, plan: StorybookChapterPlan, warnings: string[]): StorybookChapter {
  const record = asRecord(value);
  const body = optionalText(stringValue(record?.body), 30_000);
  if (!record || !body) {
    warnings.push(`Hermes returned a malformed draft for ${plan.chapterId}; inserted an empty chapter body.`);
  }
  return {
    chapterId: plan.chapterId,
    chapterTitle: optionalText(stringValue(record?.chapterTitle), 160) ?? plan.chapterTitle,
    sourceSceneIds: plan.sourceSceneIds,
    body: body ?? "",
    notes: arrayOfStrings(record?.notes).slice(0, 8)
  };
}

function normalizeFinalEditResponse(
  value: unknown,
  outline: StorybookOutline,
  chapters: StorybookChapter[],
  warnings: string[]
): { title: string; subtitle: string; chapters: StorybookChapter[]; warnings: string[] } {
  const record = asRecord(value);
  const finalWarnings = arrayOfStrings(record?.warnings).slice(0, 12);
  if (!record) {
    warnings.push("Hermes returned a malformed final edit response; preserving chapter drafts.");
  }

  const rawChapters = arrayValue(record?.chapters);
  const editedById = new Map<string, StorybookChapter>();
  for (const raw of rawChapters) {
    const chapter = asRecord(raw);
    const chapterIdValue = stringValue(chapter?.chapterId);
    const original = chapters.find((candidate) => candidate.chapterId === chapterIdValue);
    if (!chapter || !original) {
      continue;
    }
    editedById.set(original.chapterId, {
      ...original,
      chapterTitle: optionalText(stringValue(chapter.chapterTitle), 160) ?? original.chapterTitle,
      body: optionalText(stringValue(chapter.body), 30_000) ?? original.body,
      notes: arrayOfStrings(chapter.notes).slice(0, 8)
    });
  }

  return {
    title: optionalText(stringValue(record?.title), 160) ?? outline.title,
    subtitle: optionalText(stringValue(record?.subtitle), 220) ?? outline.subtitle,
    chapters: chapters.map((chapter) => editedById.get(chapter.chapterId) ?? chapter),
    warnings: finalWarnings
  };
}

function sceneSummaryInstructions(options: ResolvedStorybookOptions): string[] {
  return [
    "Return JSON with a `scenes` array.",
    "Each scene must include title, participants, timeframe, summary, emotionalWeight, keyQuotes, continuityNotes, and sourceMessageIds.",
    "Use only source message ids from the provided chunk.",
    "Do not invent major events; preserve uncertainty in continuityNotes.",
    options.quoteMode === "paraphrase_only"
      ? "Do not include direct quotes; leave keyQuotes empty or paraphrase briefly."
      : "Include only short, source-supported direct quotes when they carry the scene."
  ];
}

function relationshipArcInstructions(options: ResolvedStorybookOptions): string[] {
  return [
    "Return JSON with beginning, currentState, majorTurningPoints, recurringMotifs, sharedLanguage, and unresolvedThreads.",
    "Ground every claim in the provided scene summaries.",
    "Separate actual events from inferred emotional shape.",
    `Target style later is ${options.style}; do not write prose yet.`
  ];
}

function outlineInstructions(options: ResolvedStorybookOptions): string[] {
  return [
    "Return JSON with title, subtitle, and chapters.",
    "Each chapter must include chapterId, chapterTitle, sourceSceneIds, purpose, and styleNotes.",
    `Organize primarily by ${options.organizationMode}.`,
    `Plan for a ${options.length} storybook.`,
    "Every chapter must map to known scene ids."
  ];
}

function chapterInstructions(options: ResolvedStorybookOptions): string[] {
  return [
    "Return JSON with chapterId, chapterTitle, body, and notes.",
    `Write in the requested style: ${options.style}.`,
    "Use the source scenes for content and avoid unsupported major events.",
    options.quoteMode === "paraphrase_only"
      ? "Paraphrase the source; do not include direct transcript quotes."
      : "Use direct quotes sparingly and only when source-supported.",
    "Do not mention Hermes, prompts, source ids, or implementation details in the chapter body."
  ];
}

function finalEditInstructions(_options: ResolvedStorybookOptions): string[] {
  return [
    "Return JSON with title, subtitle, chapters, and warnings.",
    "Only revise for continuity, unsupported claims, repeated phrasing, and chapter flow.",
    "Preserve chapter ids and source scene mappings.",
    "Put any unresolved factual concern in warnings instead of inventing connective tissue."
  ];
}

function storybookSystemPrompt(): string {
  return [
    "You are Hermes, helping Kinagent turn a Kindroid transcript into a grounded storybook artifact.",
    "Return only compact JSON for the requested stage.",
    "Respect source ids and provenance. Do not invent major unsupported events.",
    "This is artifact generation only. Do not request Kindroid mutations, journals, current_scene updates, or chat sends."
  ].join("\n");
}

function publicOptions(options: ResolvedStorybookOptions) {
  return {
    organizationMode: options.organizationMode,
    length: options.length,
    style: options.style,
    quoteMode: options.quoteMode
  };
}

function chatCompletionContent(responseText: string): string {
  const parsed = JSON.parse(responseText) as ChatCompletionResponse;
  return parsed.choices?.[0]?.message?.content ?? "";
}

function extractJson(content: string): string | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function validSourceMessageIds(values: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(values.filter((value) => allowedSet.has(value)))];
}

function timeframeLabel(chunk: StorybookChunk): string {
  if (
    chunk.startTimestamp &&
    chunk.endTimestamp &&
    chunk.startTimestamp.slice(0, 10) !== chunk.endTimestamp.slice(0, 10)
  ) {
    return `${chunk.startTimestamp.slice(0, 10)} to ${chunk.endTimestamp.slice(0, 10)}`;
  }
  return chunk.startTimestamp?.slice(0, 10) ?? "Undated";
}

function sceneId(index: number): string {
  return `scene_${String(index + 1).padStart(3, "0")}`;
}

function chapterId(index: number): string {
  return `chapter_${String(index + 1).padStart(3, "0")}`;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readableText(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
