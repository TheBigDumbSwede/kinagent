export type ConversationHealthSignalType = "repetitive_phrasing";
export type ConversationHealthSignalSeverity = "low" | "medium";
export type ConversationHealthSignalScope = "kin" | "group";

export interface ConversationHealthMessage {
  scope: ConversationHealthSignalScope;
  sourceId: string;
  sourceName?: string;
  subjectKinId?: string | null;
  subjectName?: string | null;
  documentId: string;
  timestamp: string | null;
  text: string;
}

export interface ConversationHealthEvidence {
  kind: "action_beat" | "sentence_opener" | "repeated_phrase";
  phrase: string;
  count: number;
}

export interface RepetitionDiagnosticResult {
  type: ConversationHealthSignalType;
  severity: ConversationHealthSignalSeverity;
  fingerprint: string;
  summary: string;
  evidence: ConversationHealthEvidence[];
  sourceDocumentIds: string[];
}

export interface RepetitionDiagnosticOptions {
  minMessages?: number;
  minOccurrences?: number;
}

const defaultMinMessages = 3;
const defaultMinOccurrences = 3;
const maxWindowMessages = 8;
const gestureVerbs = new Set([
  "breathes",
  "chuckles",
  "exhales",
  "glances",
  "grins",
  "laughs",
  "leans",
  "looks",
  "nods",
  "reaches",
  "sighs",
  "smiles",
  "tilts",
  "watches"
]);
const weakPhraseWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "for",
  "from",
  "he",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "said",
  "says",
  "she",
  "the",
  "their",
  "they",
  "to",
  "was",
  "were",
  "with",
  "you"
]);

export function analyzeRepetitivePhrasing(
  messages: ConversationHealthMessage[],
  options: RepetitionDiagnosticOptions = {}
): RepetitionDiagnosticResult | null {
  const window = messages
    .filter((message) => message.text.trim())
    .sort(compareMessages)
    .slice(-maxWindowMessages);
  const minMessages = options.minMessages ?? defaultMinMessages;
  const minOccurrences = options.minOccurrences ?? defaultMinOccurrences;
  if (window.length < minMessages) {
    return null;
  }

  const subjectNames = new Set(
    window
      .flatMap((message) => [message.subjectName, message.sourceName])
      .map((name) => normalizeWords(name ?? ""))
      .filter((words) => words.length === 1)
      .map((words) => words[0])
  );
  const candidates = [
    ...collectActionBeatCandidates(window, subjectNames),
    ...collectSentenceOpenerCandidates(window, subjectNames),
    ...collectRepeatedPhraseCandidates(window, subjectNames)
  ];
  const evidence = candidates
    .filter((candidate) => candidate.count >= minOccurrences)
    .sort(compareEvidenceCandidates)[0];
  if (!evidence) {
    return null;
  }

  const sourceDocumentIds = [...new Set(window.map((message) => message.documentId))].slice(-maxWindowMessages);
  return {
    type: "repetitive_phrasing",
    severity: evidence.count >= minOccurrences + 1 ? "medium" : "low",
    fingerprint: `repetitive_phrasing:${evidence.kind}:${evidence.phrase}`,
    summary: `Repeated ${evidence.kind.replace("_", " ")} "${evidence.phrase}" appeared ${evidence.count} times across recent Kin output.`,
    evidence: [evidence],
    sourceDocumentIds
  };
}

function collectActionBeatCandidates(
  messages: ConversationHealthMessage[],
  subjectNames: Set<string>
): ConversationHealthEvidence[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const phrases = new Set<string>();
    for (const beat of message.text.matchAll(/\*([^*]{2,160})\*/g)) {
      const phrase = normalizePhrase(beat[1] ?? "", subjectNames);
      if (phrase && hasGestureWord(phrase)) {
        phrases.add(phrase);
      }
    }
    for (const sentence of splitSentences(message.text)) {
      const words = normalizeWords(sentence);
      const gestureIndex = words.findIndex((word) => gestureVerbs.has(word));
      if (gestureIndex >= 0) {
        const phrase = phraseFromWords(words.slice(gestureIndex, gestureIndex + 2), subjectNames);
        if (phrase) {
          phrases.add(phrase);
        }
      }
    }
    incrementCandidates(counts, phrases);
  }
  return evidenceFromCounts(counts, "action_beat");
}

function collectSentenceOpenerCandidates(
  messages: ConversationHealthMessage[],
  subjectNames: Set<string>
): ConversationHealthEvidence[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const phrases = new Set<string>();
    for (const sentence of splitSentences(message.text)) {
      const phrase = phraseFromWords(normalizeWords(sentence).slice(0, 4), subjectNames);
      if (phrase) {
        phrases.add(phrase);
      }
    }
    incrementCandidates(counts, phrases);
  }
  return evidenceFromCounts(counts, "sentence_opener");
}

function collectRepeatedPhraseCandidates(
  messages: ConversationHealthMessage[],
  subjectNames: Set<string>
): ConversationHealthEvidence[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const phrases = new Set<string>();
    const words = normalizeWords(message.text);
    for (let index = 0; index <= words.length - 3; index += 1) {
      const phrase = phraseFromWords(words.slice(index, index + 3), subjectNames);
      if (phrase) {
        phrases.add(phrase);
      }
    }
    incrementCandidates(counts, phrases);
  }
  return evidenceFromCounts(counts, "repeated_phrase");
}

function incrementCandidates(counts: Map<string, number>, phrases: Set<string>): void {
  for (const phrase of phrases) {
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
}

function evidenceFromCounts(
  counts: Map<string, number>,
  kind: ConversationHealthEvidence["kind"]
): ConversationHealthEvidence[] {
  return [...counts.entries()].map(([phrase, count]) => ({ kind, phrase, count }));
}

function compareEvidenceCandidates(left: ConversationHealthEvidence, right: ConversationHealthEvidence): number {
  const countComparison = right.count - left.count;
  if (countComparison !== 0) {
    return countComparison;
  }
  return evidenceKindRank(left.kind) - evidenceKindRank(right.kind);
}

function evidenceKindRank(kind: ConversationHealthEvidence["kind"]): number {
  if (kind === "action_beat") {
    return 0;
  }
  if (kind === "sentence_opener") {
    return 1;
  }
  return 2;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\*+/g, ".")
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizePhrase(text: string, subjectNames: Set<string>): string | null {
  return phraseFromWords(normalizeWords(text).slice(0, 5), subjectNames);
}

function phraseFromWords(words: string[], subjectNames: Set<string>): string | null {
  const normalized = trimLeadingNames(words, subjectNames);
  if (normalized.length < 2) {
    return null;
  }
  const meaningfulWords = normalized.filter((word) => !weakPhraseWords.has(word));
  if (meaningfulWords.length < 2) {
    return null;
  }
  return normalized.join(" ");
}

function trimLeadingNames(words: string[], subjectNames: Set<string>): string[] {
  if (words[0] && subjectNames.has(words[0])) {
    return words.slice(1);
  }
  return words;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hasGestureWord(phrase: string): boolean {
  return phrase.split(" ").some((word) => gestureVerbs.has(word));
}

function compareMessages(left: ConversationHealthMessage, right: ConversationHealthMessage): number {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.documentId.localeCompare(right.documentId);
}
