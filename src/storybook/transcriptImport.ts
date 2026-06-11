import type { StorybookParticipant, StorybookTranscript, StorybookTranscriptMessage } from "./storybook.js";

export type ImportedTranscriptFormat = "kinagent-markdown" | "plain-text";
export type ImportedTranscriptConfidence = "high" | "medium" | "low";

export interface ImportedStorybookTranscriptOptions {
  fileName?: string;
  displayName?: string;
}

export interface ImportedStorybookTranscriptResult {
  transcript: StorybookTranscript;
  format: ImportedTranscriptFormat;
  confidence: ImportedTranscriptConfidence;
  warnings: string[];
}

interface ParsedImportedMessage {
  sourceMessageId: string;
  speakerName: string;
  speakerKind: StorybookParticipant["kind"];
  timestamp: string | null;
  text: string;
}

interface ParseCandidate {
  format: ImportedTranscriptFormat;
  confidence: ImportedTranscriptConfidence;
  messages: ParsedImportedMessage[];
  warnings: string[];
}

export function parseImportedStorybookTranscript(
  text: string,
  options: ImportedStorybookTranscriptOptions = {}
): ImportedStorybookTranscriptResult {
  const normalizedText = text.replace(/^\uFEFF/, "");
  const markdown = parseKinagentMarkdownTranscript(normalizedText);
  const candidate = markdown.messages.length > 0 ? markdown : parsePlainTextTranscript(normalizedText);
  if (candidate.messages.length === 0) {
    throw new Error("Imported transcript did not contain any readable text.");
  }

  return {
    format: candidate.format,
    confidence: candidate.confidence,
    warnings: candidate.warnings,
    transcript: createImportedTranscript(candidate.messages, {
      id: safeSourceId(options.fileName || "imported-transcript"),
      displayName: options.displayName || displayNameFromFileName(options.fileName) || "Imported Transcript"
    })
  };
}

function parseKinagentMarkdownTranscript(text: string): ParseCandidate {
  const messages: ParsedImportedMessage[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let currentDate: string | null = null;
  let current: ParsedImportedMessage | null = null;
  let sawDateHeading = false;
  let ambiguousLines = 0;

  const flushCurrent = () => {
    if (current && current.text.trim()) {
      current.text = current.text.trim();
      messages.push(current);
    }
    current = null;
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2}|Undated)\s*$/);
    if (dateMatch) {
      flushCurrent();
      sawDateHeading = true;
      currentDate = dateMatch[1] === "Undated" ? null : dateMatch[1];
      continue;
    }

    const messageMatch = line.match(/^\[([^\]]+)]\s+([^:]{1,120}):\s?(.*)$/);
    if (messageMatch) {
      flushCurrent();
      const [, time, speakerName, body] = messageMatch;
      const timestamp = timestampFromDateAndTime(currentDate, time);
      if (!timestamp) {
        warnings.push(`Line ${lineNumber}: message timestamp could not be resolved.`);
      }
      current = {
        sourceMessageId: `import-line-${lineNumber}`,
        speakerName: speakerName.trim() || "Unknown",
        speakerKind: speakerKindForName(speakerName),
        timestamp,
        text: body
      };
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (current) {
      current.text = `${current.text}\n${line}`;
      continue;
    }

    ambiguousLines += 1;
    messages.push({
      sourceMessageId: `import-line-${lineNumber}`,
      speakerName: "Unknown",
      speakerKind: "unknown",
      timestamp: null,
      text: line.trim()
    });
  }

  flushCurrent();
  if (!sawDateHeading || messages.length === 0) {
    return {
      format: "kinagent-markdown",
      confidence: "low",
      messages: [],
      warnings: []
    };
  }
  if (ambiguousLines > 0) {
    warnings.push(
      `${ambiguousLines} non-empty line${ambiguousLines === 1 ? "" : "s"} did not match the export pattern.`
    );
  }

  return {
    format: "kinagent-markdown",
    confidence: warnings.length === 0 ? "high" : "medium",
    messages,
    warnings
  };
}

function parsePlainTextTranscript(text: string): ParseCandidate {
  const messages: ParsedImportedMessage[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let currentDate: string | null = null;
  let current: ParsedImportedMessage | null = null;
  let paragraph: string[] = [];
  let speakerLineCount = 0;

  const flushCurrent = () => {
    if (current && current.text.trim()) {
      current.text = current.text.trim();
      messages.push(current);
    }
    current = null;
  };
  const flushParagraph = (lineNumber: number) => {
    const textBlock = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph = [];
    if (!textBlock) {
      return;
    }
    messages.push({
      sourceMessageId: `import-line-${lineNumber}`,
      speakerName: "Unknown",
      speakerKind: "unknown",
      timestamp: null,
      text: textBlock
    });
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const dateMatch = trimmed.match(/^(?:#+\s*)?(\d{4}-\d{2}-\d{2})(?:\s*)$/);
    if (dateMatch) {
      flushCurrent();
      flushParagraph(lineNumber);
      currentDate = dateMatch[1];
      continue;
    }

    if (!trimmed) {
      flushCurrent();
      flushParagraph(lineNumber);
      continue;
    }

    const bracketedMatch = trimmed.match(/^\[([^\]]+)]\s+([^:]{1,120}):\s?(.*)$/);
    const speakerMatch = bracketedMatch ?? trimmed.match(/^([^:]{1,80}):\s+(.+)$/);
    if (speakerMatch) {
      flushCurrent();
      flushParagraph(lineNumber);
      speakerLineCount += 1;
      if (bracketedMatch) {
        const [, stamp, speakerName, body] = bracketedMatch;
        current = {
          sourceMessageId: `import-line-${lineNumber}`,
          speakerName: speakerName.trim() || "Unknown",
          speakerKind: speakerKindForName(speakerName),
          timestamp: timestampFromFlexibleStamp(currentDate, stamp),
          text: body
        };
      } else {
        const [, speakerName, body] = speakerMatch;
        current = {
          sourceMessageId: `import-line-${lineNumber}`,
          speakerName: speakerName.trim() || "Unknown",
          speakerKind: speakerKindForName(speakerName),
          timestamp: null,
          text: body
        };
      }
      if (!current.timestamp) {
        warnings.push(`Line ${lineNumber}: message has no usable timestamp.`);
      }
      continue;
    }

    if (current && /^\s/.test(line)) {
      current.text = `${current.text}\n${trimmed}`;
    } else {
      flushCurrent();
      paragraph.push(trimmed);
    }
  }

  flushCurrent();
  flushParagraph(lines.length);
  if (speakerLineCount === 0) {
    warnings.push("No speaker labels were detected; paragraph blocks were imported as Unknown speaker messages.");
  }

  return {
    format: "plain-text",
    confidence: speakerLineCount > 0 ? "medium" : "low",
    messages,
    warnings
  };
}

function createImportedTranscript(
  messages: ParsedImportedMessage[],
  source: { id: string; displayName: string }
): StorybookTranscript {
  const normalized = messages.map((message, index): StorybookTranscriptMessage => {
    const speakerId = speakerIdFor(message.speakerName, message.speakerKind);
    return {
      id: `msg_${String(index + 1).padStart(5, "0")}`,
      sourceMessageId: message.sourceMessageId,
      sequence: index,
      speakerId,
      speakerName: message.speakerName,
      speakerKind: message.speakerKind,
      timestamp: message.timestamp,
      text: message.text
    };
  });

  return {
    conversationId: `import:${source.id}`,
    source: {
      scope: "import",
      id: source.id,
      displayName: source.displayName,
      source: "imported-transcript"
    },
    participants: participantList(normalized),
    messages: normalized,
    metadata: {
      messageCount: normalized.length,
      firstTimestamp: normalized[0]?.timestamp ?? null,
      lastTimestamp: normalized[normalized.length - 1]?.timestamp ?? null
    }
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

function timestampFromDateAndTime(date: string | null, time: string | undefined): string | null {
  if (!date || !time || time === "Unknown" || !/^\d{1,2}:\d{2}$/.test(time)) {
    return null;
  }
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function timestampFromFlexibleStamp(currentDate: string | null, stamp: string): string | null {
  const trimmed = stamp.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return timestampFromDateAndTime(currentDate, trimmed);
}

function speakerKindForName(name: string): StorybookParticipant["kind"] {
  const normalized = name.trim().toLowerCase();
  if (normalized === "user" || normalized === "human" || normalized === "me") {
    return "user";
  }
  return normalized ? "kin" : "unknown";
}

function speakerIdFor(name: string, kind: StorybookParticipant["kind"]): string {
  if (kind === "user") {
    return "user";
  }
  if (kind === "unknown") {
    return `unknown:${safeSourceId(name || "speaker")}`;
  }
  return `speaker:${safeSourceId(name)}`;
}

function displayNameFromFileName(fileName?: string): string | null {
  if (!fileName) {
    return null;
  }
  return (
    fileName
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || null
  );
}

function safeSourceId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "imported-transcript"
  );
}
