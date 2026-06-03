import { describe, expect, it } from "vitest";
import { kindroidDesignRubric, renderKinAnalysisReport } from "../src/kinAnalysis/kinAnalysis.js";

describe("Kin analysis report", () => {
  it("renders dynamism fit and structured recommendations", () => {
    const analysis: Parameters<typeof renderKinAnalysisReport>[0] = {
      summary: "The Kin is grounded and coherent, but the current Dynamism setting is too variable for the design.",
      overall: {
        rating: "needs_attention",
        confidence: "medium"
      },
      dynamism: {
        assessment:
          "A high setting gives Hermes and Kindroid more variability than the captured simple, stable personality calls for.",
        recommendation: "Bring the target closer to 0.95 and keep drift inside 0.90 - 1.05 unless the design changes."
      },
      findings: [
        {
          category: "dynamism",
          severity: "medium",
          title: "Dynamism is higher than the stability profile implies",
          observation: "The captured fields describe a simple, steady personality, but current Dynamism is set high.",
          evidence: ["Backstory emphasizes grounded habits and steady routines.", "Current Dynamism is 1.35."],
          recommendation: "Use 0.95 as the starting point and adjust by 0.05 after reviewing actual chat behavior."
        }
      ],
      nextSteps: ["Review the Dynamism range before accepting future drift suggestions."]
    };

    const report = renderKinAnalysisReport(analysis, {
      kinName: "Alexis",
      captured: { folderName: "Alexis--2026-06-03" },
      chatDynamism: {
        raw: "1.35",
        numeric: 1.35,
        display: "1.35"
      },
      chatDynamismPreference: {
        enabled: true,
        min: 0.9,
        max: 1.05
      }
    });

    expect(report).toContain("# Kin Analysis: Alexis");
    expect(report).toContain("Current: 1.35");
    expect(report).toContain("Allowed drift range: 0.90 - 1.05");
    expect(report).toContain("## Chat Dynamism Fit");
    expect(report).toContain("Dynamism is higher than the stability profile implies");
    expect(report).toContain("adjust by 0.05");
  });

  it("treats Response Directive as a high-leverage minimal field", () => {
    const rubric = kindroidDesignRubric();

    expect(rubric).toContain("high-leverage output-control field");
    expect(rubric).toContain("should usually be minimal");
    expect(rubric).toContain("may be empty");
    expect(rubric).toContain("negative prohibitions");
    expect(rubric).toContain("heavy-handed");
  });

  it("treats Example Messages as an expressive palette", () => {
    const rubric = kindroidDesignRubric();

    expect(rubric).toContain("range of expression");
    expect(rubric).toContain("one example gives a point");
    expect(rubric).toContain("two examples give a line");
    expect(rubric).toContain("three or more well-varied examples give a broader plane");
    expect(rubric).toContain("too narrow");
  });
});
