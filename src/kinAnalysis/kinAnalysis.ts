import { readCapturedKin, type CapturedKinView } from "../capture/captureReader.js";
import type { AppConfig } from "../config/types.js";
import type { ChatDynamismValue } from "../kindroid/chatDynamism.js";
import type { KinChatDynamismPreference } from "../runtime/bridgeRuntime.js";
import type { Logger } from "../util/logger.js";

export interface KinAnalysisOptions {
  kinId: string;
  kinName?: string;
  chatDynamism?: ChatDynamismValue | null;
  chatDynamismPreference?: KinChatDynamismPreference;
}

export interface KinAnalysisProgress {
  phase: "loading" | "requesting" | "rendering" | "complete";
  message: string;
}

export interface KinAnalysisResult {
  ok: true;
  reportMarkdown: string;
  findingCount: number;
}

interface HermesChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface StructuredKinAnalysis {
  summary?: unknown;
  overall?: {
    rating?: unknown;
    confidence?: unknown;
  };
  dynamism?: {
    current?: unknown;
    assessment?: unknown;
    recommendation?: unknown;
  };
  findings?: unknown;
  nextSteps?: unknown;
}

interface AnalysisFinding {
  category: string;
  severity: string;
  title: string;
  observation: string;
  evidence: string[];
  recommendation: string;
}

export async function analyzeKinDesign(
  config: AppConfig,
  logger: Logger,
  options: KinAnalysisOptions,
  onProgress: (progress: KinAnalysisProgress) => void
): Promise<KinAnalysisResult> {
  if (!options.kinId) {
    throw new Error("Select a Kin before running analysis.");
  }
  if (!config.hermes.enabled) {
    throw new Error("Enable Hermes before running Kin analysis.");
  }
  if (!config.hermes.apiKey) {
    throw new Error("Hermes analysis requires a Hermes API key.");
  }

  onProgress({ phase: "loading", message: "Loading captured Kin fields." });
  const captured = await readCapturedKin(options.kinId);
  if (!captured.ok) {
    throw new Error(captured.error || "No captured state found for this Kin yet.");
  }

  onProgress({ phase: "requesting", message: "Asking Hermes to analyze the Kin design." });
  const analysis = await requestHermesAnalysis(config, logger, captured, options);

  onProgress({ phase: "rendering", message: "Rendering analysis report." });
  const reportMarkdown = renderKinAnalysisReport(analysis, {
    kinName: options.kinName || options.kinId,
    captured,
    chatDynamism: options.chatDynamism,
    chatDynamismPreference: options.chatDynamismPreference
  });
  const findingCount = normalizeFindings(analysis.findings).length;

  onProgress({ phase: "complete", message: "Analysis report ready." });
  return { ok: true, reportMarkdown, findingCount };
}

export function renderKinAnalysisReport(
  analysis: StructuredKinAnalysis,
  context: {
    kinName: string;
    captured: Pick<CapturedKinView, "folderName">;
    chatDynamism?: ChatDynamismValue | null;
    chatDynamismPreference?: KinChatDynamismPreference;
  }
): string {
  const findings = normalizeFindings(analysis.findings);
  const nextSteps = normalizeStringArray(analysis.nextSteps);
  const lines: string[] = [
    `# Kin Analysis: ${context.kinName}`,
    "",
    `Capture: ${context.captured.folderName || "Unavailable"}`,
    `Overall: ${stringValue(analysis.overall?.rating, "Unrated")} (${stringValue(analysis.overall?.confidence, "unknown confidence")})`,
    "",
    "## Summary",
    "",
    stringValue(analysis.summary, "No summary returned."),
    "",
    "## Chat Dynamism Fit",
    "",
    `Current: ${context.chatDynamism?.display || "Unknown"}`,
    context.chatDynamismPreference
      ? `Allowed drift range: ${context.chatDynamismPreference.min.toFixed(2)} - ${context.chatDynamismPreference.max.toFixed(2)}`
      : "Allowed drift range: Unknown",
    "",
    stringValue(analysis.dynamism?.assessment, "No Dynamism assessment returned."),
    "",
    `Recommendation: ${stringValue(analysis.dynamism?.recommendation, "No Dynamism recommendation returned.")}`,
    "",
    "## Findings",
    ""
  ];

  if (findings.length === 0) {
    lines.push("No specific findings returned.");
  }

  for (const finding of findings) {
    lines.push(`### ${finding.title}`);
    lines.push("");
    lines.push(`Severity: ${finding.severity}`);
    lines.push(`Category: ${finding.category}`);
    lines.push("");
    lines.push(finding.observation);
    if (finding.evidence.length > 0) {
      lines.push("");
      lines.push("Evidence:");
      for (const evidence of finding.evidence) {
        lines.push(`- ${evidence}`);
      }
    }
    lines.push("");
    lines.push(`Recommendation: ${finding.recommendation}`);
    lines.push("");
  }

  lines.push("## Suggested Next Steps");
  lines.push("");
  if (nextSteps.length === 0) {
    lines.push("No next steps returned.");
  } else {
    for (const step of nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

async function requestHermesAnalysis(
  config: AppConfig,
  logger: Logger,
  captured: CapturedKinView,
  options: KinAnalysisOptions
): Promise<StructuredKinAnalysis> {
  const response = await fetch(`${normalizeBaseUrl(config.hermes.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.hermes.apiKey}`
    },
    body: JSON.stringify({
      model: "hermes-agent",
      messages: [
        {
          role: "system",
          content: kinAnalysisSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "analyze_kindroid_kin_design",
            kin: {
              aiId: options.kinId,
              name: options.kinName || options.kinId,
              chatDynamism: options.chatDynamism,
              chatDynamismPreference: options.chatDynamismPreference
            },
            designRubric: kindroidDesignRubric(),
            capturedFields: captured.fields.map((field) => ({
              key: field.key,
              label: field.label,
              available: field.available,
              kind: field.kind,
              content: field.content
            }))
          })
        }
      ]
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Hermes analysis request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  const result = JSON.parse(responseText) as HermesChatCompletionResult;
  const content = result.choices?.[0]?.message?.content ?? "";
  const parsed = parseStructuredAnalysis(content);
  logger.info("Hermes Kin analysis completed.", {
    kinId: options.kinId,
    findingCount: normalizeFindings(parsed.findings).length
  });
  return parsed;
}

function kinAnalysisSystemPrompt(): string {
  return [
    "You are Hermes, producing a review-only Kindroid Kin design analysis for Kinagent.",
    "Do not propose automatic mutations. Do not call tools. Do not write to Kindroid.",
    "Compare the captured Kin fields against the provided Kindroid design rubric.",
    "Look for contradictions, field-placement problems, missing anchors, overbroad durable rules, mismatched directives, journal misuse, and Response Directive / Example Message conflicts.",
    "Treat the Response Directive as one of the strongest and easiest-to-overuse Kin modifiers. Prefer minimal directives, and consider an empty directive acceptable when Backstory, Memories, Greeting, and Example Message already carry the design.",
    "When reviewing the Response Directive, prioritize whether it is too restrictive, too heavy-handed, internally contradictory, or built around negative prohibitions instead of positive desired behavior.",
    "Treat Example Messages as samples that define the Kin's reachable communication space. One narrow example can collapse the Kin into a single point; two examples create a line of possible expression; three or more varied examples create a broader plane or palette.",
    "When reviewing Example Messages, judge whether they give the Kin enough room to explore its intended voice, mood, pacing, and interaction style, or whether they arbitrarily overconstrain every reply to one pattern.",
    "Treat Chat Dynamism as a stability/variability hint. 0.95 is the neutral starting value; 0.05 is a noticeable adjustment; 0.8-1.4 is the practical band; 0.6-1.8 is the hard envelope.",
    "High Dynamism implies more variability and less stability; low Dynamism implies more consistency and restraint. Judge whether that fits the Kin's intended personality, complexity, and role.",
    'Return only JSON with this shape: {"summary":"...","overall":{"rating":"strong|solid|needs_attention|high_risk","confidence":"high|medium|low"},"dynamism":{"current":"...","assessment":"...","recommendation":"..."},"findings":[{"category":"backstory|memory|journal|directive|example|scene|profile|dynamism|contradiction|placement|consistency","severity":"high|medium|low","title":"...","observation":"...","evidence":["..."],"recommendation":"..."}],"nextSteps":["..."]}.',
    "Evidence should quote or closely paraphrase the captured fields. Keep recommendations concrete and reviewable."
  ].join("\n");
}

export function kindroidDesignRubric(): string {
  return [
    "Backstory: stable identity, durable traits, world premise, and character anchors. It should not be a dumping ground for transient events, journal capsules, or procedural rules.",
    "Key Memories: important facts, current relationship state, user preferences, and boundary anchors. Keep them durable and currently relevant.",
    "Journal Entries: triggerable capsules for durable events, decisions, milestones, relationship changes, important personal facts, recurring patterns, behavior callbacks, place/world capsules, or backstory hook movement. Do not use journals as generic lore storage or duplicated backstory.",
    "Response Directive: a high-leverage output-control field for length, point of view, format, narration/dialogue balance, and pacing. It should usually be minimal, and may be empty when other fields already define the Kin well.",
    "Response Directive risk checks: flag directives that are restrictive, heavy-handed, internally contradictory, personality-rewriting, or dominated by negative prohibitions. Prefer concise positive behavior guidance over long lists of banned behaviors.",
    "Greeting Message: scene launch and response invitation.",
    "Example Message: voice, cadence, formatting, paragraph rhythm, emotional register, and range of expression. It often overpowers abstract instructions if inconsistent.",
    "Example Message palette checks: one example gives a point and may make the Kin see all replies through that one sample; two examples give a line of possibilities; three or more well-varied examples give a broader plane. Flag examples that are too few, too similar, too narrow, or mismatched to the intended personality.",
    "Current Scene: current location/activity/situation only, not stable identity or memory.",
    "Good design avoids contradictions across Backstory, Key Memories, Directive, Greeting, Example, Current Scene, and Journal entries.",
    "Simple, grounded Kins generally benefit from stability and clear anchors. Highly improvisational, surreal, or volatile Kins can tolerate more variability. Dynamism should match that intended stability profile."
  ].join("\n");
}

function parseStructuredAnalysis(content: string): StructuredKinAnalysis {
  const jsonText = extractJsonObject(content.trim());
  if (!jsonText) {
    return {
      summary: content.trim() || "Hermes returned no analysis.",
      findings: [],
      nextSteps: []
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as StructuredKinAnalysis;
    return parsed && typeof parsed === "object" ? parsed : { findings: [] };
  } catch {
    return {
      summary: content.trim() || "Hermes returned invalid analysis JSON.",
      findings: [],
      nextSteps: ["Run analysis again."]
    };
  }
}

function extractJsonObject(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}

function normalizeFindings(value: unknown): AnalysisFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): AnalysisFinding | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      return {
        category: stringValue(record.category, "general"),
        severity: stringValue(record.severity, "medium"),
        title: stringValue(record.title, "Finding"),
        observation: stringValue(record.observation, "No observation returned."),
        evidence: normalizeStringArray(record.evidence),
        recommendation: stringValue(record.recommendation, "No recommendation returned.")
      };
    })
    .filter((finding): finding is AnalysisFinding => Boolean(finding));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
