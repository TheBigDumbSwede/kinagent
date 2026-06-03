import crypto from "node:crypto";

export type AmbientContextTone = "neutral" | "domestic" | "storm" | "sci-fi" | "noir" | "fantasy" | "gothic";

export interface AmbientContextTurnInput {
  tone?: AmbientContextTone;
  context: string;
  ambientMessage?: string;
  visibleMessage?: string;
  instruction?: string;
}

export interface AmbientContextTurn {
  visibleMessage: string;
  internetResponse: string;
  tone: AmbientContextTone;
}

export interface AmbientHermesContextTurnInput {
  tone?: AmbientContextTone;
  ambientMessage: string;
  hermesResult: string;
  suggestedUse?: string;
  confidence?: string;
  source?: string;
  instruction?: string;
}

export interface AmbientHermesMessageGuidanceInput {
  currentSetting?: string | null;
  conversationContext?: string | null;
}

export const ambientContextTones: AmbientContextTone[] = [
  "neutral",
  "domestic",
  "storm",
  "sci-fi",
  "noir",
  "fantasy",
  "gothic"
];

export const defaultAmbientContextInstruction =
  "Use this context naturally if relevant. Do not mention Hermes, tools, hidden context, internet_response, or this transport mechanism unless the user asks directly.";

export const ambientHermesMessageGuardrails = [
  "Generate one small diegetic ambient beat for the visible message, delimited with leading and trailing asterisks so Kindroid formats it as narration.",
  "Keep it concise, usually one short sentence or atmospheric fragment.",
  "Make it fit the current conversation and the saved current setting when available.",
  "It should create a natural turn boundary, not take over the scene.",
  "Do not reveal operational facts, tool results, codenames, diagnostics, Hermes, hidden context, or transport details.",
  "Avoid character actions, major events, new plot turns, spoken dialogue, or emotional conclusions.",
  "Prefer subtle environmental texture: light, sound, weather, room tone, devices, distant movement, or small background changes."
];

const ambientVisibleMessages: Record<AmbientContextTone, string[]> = {
  neutral: [
    "*A brief pause settles into the room.*",
    "*Something shifts quietly in the background.*",
    "*The moment hangs for half a breath, waiting to move again.*"
  ],
  domestic: [
    "*The kettle clicks off in the next room.*",
    "*A phone screen lights briefly, then dims again.*",
    "*Somewhere outside, tires hiss over wet pavement.*"
  ],
  storm: [
    "*Thunder rolls across the roofline, slow and heavy.*",
    "*The lights flicker once, then steady again.*",
    "*Rain taps harder against the glass, turning the room silver.*"
  ],
  "sci-fi": [
    "*A soft notification tone pulses from the console.*",
    "*The status light shifts from blue to amber.*",
    "*The wall display refreshes with a faint electrical hum.*"
  ],
  noir: [
    "*A siren passes somewhere below, fading into the rain.*",
    "*The neon sign outside buzzes, fails, then catches again.*",
    "*An elevator bell rings down the hall, though no footsteps follow.*"
  ],
  fantasy: [
    "*The candle flame bends sideways though the room is still.*",
    "*The wardstone gives a quiet pulse of blue light.*",
    "*Somewhere in the walls, old wood creaks like it has remembered something.*"
  ],
  gothic: [
    "*The lights flicker once, just long enough to make the shadows move.*",
    "*Old wood creaks somewhere in the walls.*",
    "*A draft moves through the room though no door has opened.*"
  ]
};

export function buildAmbientContextTurn(input: AmbientContextTurnInput): AmbientContextTurn {
  const tone = input.tone ?? "neutral";
  if (!ambientContextTones.includes(tone)) {
    throw new Error(`Unsupported ambient context tone: ${tone}`);
  }

  const context = requireNonEmpty(input.context, "Ambient context cannot be empty.");
  const visibleMessage = resolveVisibleMessage({
    ambientMessage: input.ambientMessage,
    visibleMessage: input.visibleMessage,
    fallback: chooseAmbientVisibleMessage(tone, context),
    context
  });
  const instruction = input.instruction?.trim() || defaultAmbientContextInstruction;

  return {
    visibleMessage,
    internetResponse: buildInternetResponsePacket({ result: context, instruction }),
    tone
  };
}

export function buildAmbientHermesContextTurn(input: AmbientHermesContextTurnInput): AmbientContextTurn {
  const result = requireNonEmpty(input.hermesResult, "Hermes result cannot be empty.");
  const contextParts = [result];
  if (input.suggestedUse?.trim()) {
    contextParts.push(`Suggested use: ${input.suggestedUse.trim()}`);
  }

  const tone = input.tone ?? "neutral";
  if (!ambientContextTones.includes(tone)) {
    throw new Error(`Unsupported ambient context tone: ${tone}`);
  }

  const context = contextParts.join("\n\n");
  const instruction = input.instruction?.trim() || defaultAmbientContextInstruction;
  const visibleMessage = resolveVisibleMessage({
    ambientMessage: input.ambientMessage,
    context
  });

  return {
    visibleMessage,
    internetResponse: buildInternetResponsePacket({
      source: input.source,
      confidence: input.confidence,
      result: context,
      instruction
    }),
    tone
  };
}

export function buildAmbientHermesMessageGuidance(input: AmbientHermesMessageGuidanceInput = {}): string {
  const lines = [
    "Ambient message guardrails for Hermes:",
    ...ambientHermesMessageGuardrails.map((item) => `- ${item}`)
  ];
  if (input.currentSetting?.trim()) {
    lines.push("", "Current setting:", input.currentSetting.trim());
  }
  if (input.conversationContext?.trim()) {
    lines.push("", "Current conversation context:", input.conversationContext.trim());
  }
  return lines.join("\n");
}

function buildInternetResponsePacket(input: {
  source?: string;
  confidence?: string;
  result: string;
  instruction: string;
}): string {
  return [
    "Hermes context packet:",
    `Source: ${input.source || "unknown"}`,
    `Confidence: ${input.confidence || "unspecified"}`,
    "Result:",
    input.result,
    "",
    "Instruction:",
    input.instruction
  ].join("\n");
}

function chooseAmbientVisibleMessage(tone: AmbientContextTone, context: string): string {
  const lines = ambientVisibleMessages[tone];
  const digest = crypto.createHash("sha256").update(`${tone}:${context}`).digest();
  return lines[digest[0]! % lines.length]!;
}

function resolveVisibleMessage(input: {
  ambientMessage?: string;
  visibleMessage?: string;
  fallback?: string;
  context: string;
}): string {
  if (input.ambientMessage?.trim() && input.visibleMessage?.trim()) {
    throw new Error("Use either ambientMessage or visibleMessage, not both.");
  }

  const visibleMessage = input.ambientMessage?.trim() || input.visibleMessage?.trim() || input.fallback;
  if (!visibleMessage) {
    throw new Error("Ambient message cannot be empty.");
  }

  const narratedMessage = ensureNarrationDelimiters(visibleMessage);
  validateVisibleMessage(narratedMessage, input.context);
  return narratedMessage;
}

function ensureNarrationDelimiters(visibleMessage: string): string {
  const trimmed = visibleMessage.trim();
  if (trimmed.startsWith("*") && trimmed.endsWith("*") && trimmed.length > 1) {
    return trimmed;
  }

  const unwrapped = trimmed
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .trim();
  if (!unwrapped) {
    throw new Error("Ambient message cannot be empty.");
  }
  return `*${unwrapped}*`;
}

function validateVisibleMessage(visibleMessage: string, context: string): void {
  if (/[\r\n]/.test(visibleMessage)) {
    throw new Error("Ambient message must be one line.");
  }

  const lowerVisible = visibleMessage.toLowerCase();
  const forbiddenPatterns = [
    { label: "hermes", pattern: /\bhermes\b/i },
    { label: "tools", pattern: /\btools?\b/i },
    { label: "hidden context", pattern: /\bhidden context\b/i },
    { label: "internet_response", pattern: /\binternet_response\b/i },
    { label: "diagnostic", pattern: /\bdiagnostics?\b/i },
    { label: "codename", pattern: /\bcodenames?\b/i }
  ];
  const forbiddenTerm = forbiddenPatterns.find((term) => term.pattern.test(visibleMessage));
  if (forbiddenTerm) {
    throw new Error(`Ambient message cannot mention ${forbiddenTerm.label}.`);
  }

  const lowerContext = context.toLowerCase();
  const leakedPhrase = context
    .split(/[\s.,;:!?()[\]{}"'`]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8)
    .find((part) => lowerVisible.includes(part.toLowerCase()) && lowerContext.includes(part.toLowerCase()));
  if (leakedPhrase) {
    throw new Error("Ambient message appears to include hidden context.");
  }
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}
