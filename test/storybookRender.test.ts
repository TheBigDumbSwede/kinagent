import { describe, expect, it } from "vitest";
import { renderStorybookHtml } from "../src/storybook/storybookRender.js";
import type { StorybookDocument } from "../src/storybook/storybook.js";

describe("storybook HTML renderer", () => {
  it("renders escaped preview HTML with chapter provenance and generation notes", () => {
    const html = renderStorybookHtml(
      storybookDocument({
        body: "They spoke around <script>alert('x')</script> and chose trust."
      })
    );

    expect(html).toContain("A &lt;Private&gt; Chronicle");
    expect(html).toContain("One &amp; Two");
    expect(html).toContain("The &lt;Signal&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("Source scenes: scene-1, scene-2");
    expect(html).toContain("Hermes returned &lt;partial&gt; output.");
    expect(html).not.toContain("<script>alert");
  });

  it("turns long single-block chapter prose into readable paragraphs", () => {
    const body = [
      "The first long beat gives the chapter enough room to become tiring when it is rendered as one wall of text, so the renderer needs to break it apart without waiting for perfect model formatting.",
      "The second beat keeps the same emotional thread moving while adding enough sentence length to cross the paragraph threshold in a realistic generated chapter.",
      "The third beat gives the reader a place to breathe after the setup, and it should become part of a later paragraph rather than remaining glued to the opening.",
      "The fourth beat closes the passage with another complete sentence so sentence-aware splitting can make a clean break."
    ].join(" ");
    const html = renderStorybookHtml(storybookDocument({ body }));

    expect(html).toContain('<div class="chapter-body"><p>');
    expect((html.match(/<p>/g) ?? []).length).toBeGreaterThan(1);
    expect(html).not.toContain(`${escapeForExpectation(body)}</div>`);
  });
});

function storybookDocument(input: { body: string }): StorybookDocument {
  return {
    title: "A <Private> Chronicle",
    subtitle: "One & Two",
    options: {
      organizationMode: "relationship_arc",
      length: "compact",
      style: "literary chronicle",
      quoteMode: "paraphrase_only",
      chunking: {
        maxMessagesPerChunk: 40,
        maxCharactersPerChunk: 12_000,
        maxTimeGapMs: 86_400_000,
        minMessagesBeforeParticipantSplit: 8
      }
    },
    source: {
      scope: "kin",
      id: "kin-1",
      displayName: "Alex & Bruce",
      source: "kindroid-chat-history"
    },
    generatedAt: "2026-06-11T15:00:00.000Z",
    sceneSummaries: [],
    relationshipArc: {
      beginning: "",
      currentState: "",
      majorTurningPoints: [],
      recurringMotifs: [],
      sharedLanguage: [],
      unresolvedThreads: []
    },
    outline: {
      title: "A <Private> Chronicle",
      subtitle: "One & Two",
      chapters: []
    },
    chapters: [
      {
        chapterId: "chapter-<one>",
        chapterTitle: "The <Signal>",
        sourceSceneIds: ["scene-1", "scene-2"],
        body: input.body,
        notes: ["Direct quotes were paraphrased."]
      }
    ],
    warnings: ["Hermes returned <partial> output."]
  };
}

function escapeForExpectation(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
