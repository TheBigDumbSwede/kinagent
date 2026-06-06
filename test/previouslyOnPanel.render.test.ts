import fs from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Locator, type Page } from "playwright";

describe("Previously On panel renderer", () => {
  let browser: Browser | null = null;

  afterEach(async () => {
    await browser?.close();
    browser = null;
  });

  it("renders a populated continuity brief and wires refresh", async () => {
    const page = await newPanelPage();

    await page.evaluate(() => {
      window.refreshCount = 0;
      window.renderPreviouslyOnPanel({
        container: document.querySelector("#panel") as HTMLElement,
        title: "Previously On Alexis",
        brief: {
          facts: ["Bruce joked to avoid admitting he was exhausted.", "Alexis had just noticed."],
          inferredTone: "quiet, affectionate, not melodramatic",
          unresolvedThreads: ["Whether Bruce will admit what is wrong."],
          suggestedOpeningFrame: "A small practical gesture, then one pointed question.",
          recap: "The last beat ended with Alexis recognizing the deflection.",
          confidence: "high",
          updatedAt: "2026-06-06T20:14:00.000Z"
        },
        catchup: null,
        refreshSaving: false,
        formatTimestamp: () => "6/6/2026, 3:14 PM",
        onRefresh: () => {
          window.refreshCount += 1;
        }
      });
    });

    await expectText(page, "Previously On Alexis");
    await expectText(page, "Known facts");
    await expectText(page, "Bruce joked to avoid admitting he was exhausted.");
    await expectText(page, "Inferred tone:");
    await expectText(page, "Suggested opening frame:");
    await expectText(page, "Updated 6/6/2026, 3:14 PM · Confidence high");

    await page.locator("button", { hasText: "Refresh Recap" }).click();
    expect(await page.evaluate(() => window.refreshCount)).toBe(1);
    expect(await page.locator("#panel").evaluate((element) => (element as HTMLElement).hidden)).toBe(false);
  });

  it("renders the empty state and disables refresh while saving", async () => {
    const page = await newPanelPage();

    await page.evaluate(() => {
      window.refreshCount = 0;
      window.renderPreviouslyOnPanel({
        container: document.querySelector("#panel") as HTMLElement,
        title: "Previously On Evening Group",
        brief: null,
        catchup: null,
        refreshSaving: true,
        formatTimestamp: (value) => value,
        onRefresh: () => {
          window.refreshCount += 1;
        }
      });
    });

    await expectText(page, "Previously On Evening Group");
    await expectText(page, "No continuity recap has been generated for this source yet.");
    const button = page.locator("button", { hasText: "Refreshing" });
    await expectElementDisabled(button);
    expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  });

  it("shows chat history catch-up progress and disables refresh", async () => {
    const page = await newPanelPage();

    await page.evaluate(() => {
      window.refreshCount = 0;
      window.renderPreviouslyOnPanel({
        container: document.querySelector("#panel") as HTMLElement,
        title: "Previously On Hazel",
        brief: null,
        catchup: {
          chatHistoryCursorTimestamp: 1_753_194_009_599,
          updatedAt: "2026-06-06T20:47:24.113Z"
        },
        refreshSaving: false,
        formatTimestamp: () => "6/6/2026, 3:47 PM",
        onRefresh: () => {
          window.refreshCount += 1;
        }
      });
    });

    await expectText(page, "Chat history catch-up is in progress.");
    await expectText(page, "This can take a while for long histories.");
    await expectText(page, "Last advanced 6/6/2026, 3:47 PM.");
    const button = page.locator("button", { hasText: "Catching Up" });
    await expectElementDisabled(button);
    expect(await page.evaluate(() => window.refreshCount)).toBe(0);
  });

  async function newPanelPage() {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const css = fs.readFileSync("src/desktop/renderer/styles.css", "utf8");
    const rendererSource = fs.readFileSync("src/desktop/renderer/previouslyOnPanel.ts", "utf8");
    const compiled = ts.transpileModule(rendererSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText;
    await page.setContent(`<!doctype html>
      <html>
        <head><style>${css}</style></head>
        <body>
          <section id="panel" class="previously-on-panel" hidden></section>
          <script>
            window.refreshCount = 0;
            var exports = {};
            var module = { exports };
            ${compiled}
            window.renderPreviouslyOnPanel = module.exports.renderPreviouslyOnPanel || exports.renderPreviouslyOnPanel;
          </script>
        </body>
      </html>`);
    return page;
  }
});

async function expectText(page: Page, text: string): Promise<void> {
  expect(await page.getByText(text, { exact: false }).count()).toBeGreaterThan(0);
}

async function expectElementDisabled(locator: Locator): Promise<void> {
  expect(await locator.evaluate((element) => (element as HTMLButtonElement).disabled)).toBe(true);
}

declare global {
  interface Window {
    refreshCount: number;
    renderPreviouslyOnPanel(input: {
      container: HTMLElement;
      title: string;
      brief: unknown;
      catchup?: unknown;
      refreshSaving: boolean;
      formatTimestamp: (value: string) => string;
      onRefresh: () => void;
    }): void;
  }
}
