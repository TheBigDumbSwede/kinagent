import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, resolveElevenLabsApiKey } from "../scripts/soundscape/generate-elevenlabs-palette.js";
import { analyzeSoundscapeAsset, summarizeSoundscapeAnalysis } from "../src/soundscape/generation/audioAnalysis.js";
import { generateElevenLabsSound } from "../src/soundscape/generation/elevenLabsProvider.js";
import {
  catalogEntryFromPlanItem,
  createGenerationPlan,
  emptyGeneratedCatalog,
  extensionFromContentType,
  generatedFileName,
  readGeneratedCatalog,
  upsertCatalogEntry,
  validatePaletteDefinition,
  writeJsonAtomic,
  type GeneratedSoundscapeCatalog,
  type SoundscapePaletteDefinition,
  type SoundscapePaletteItem
} from "../src/soundscape/generation/palette.js";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("soundscape palette validation", () => {
  it("validates the checked-in palette definition", () => {
    const palettePath = path.resolve("scripts", "soundscape", "soundscape-palette.definition.json");
    const palette = validatePaletteDefinition(JSON.parse(fs.readFileSync(palettePath, "utf8")) as unknown);

    expect(palette.version).toBe(1);
    expect(palette.items.length).toBeGreaterThan(30);
    expect(palette.items.some((item) => item.id === "rain_window_soft_01")).toBe(true);
    expect(palette.items.some((item) => item.category === "murmur")).toBe(true);
  });

  it("rejects overlong sounds", () => {
    expect(() =>
      validatePaletteDefinition({
        version: 1,
        items: [{ ...samplePaletteItem(), durationSeconds: 31 }]
      })
    ).toThrow(/durationSeconds must be at most 30/);
  });
});

describe("soundscape generation planning", () => {
  it("uses loop and cue folders with stable filenames", () => {
    expect(generatedFileName("Door Creak!", 2, ".MP3")).toBe("door_creak_v2.mp3");
    expect(extensionFromContentType("audio/wav", "mp3_44100_128")).toBe("wav");
    expect(extensionFromContentType("audio/mpeg", "pcm_44100")).toBe("mp3");
  });

  it("skips existing assets when the catalog source hash still matches", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-soundscape-"));
    const definition: SoundscapePaletteDefinition = { version: 1, items: [samplePaletteItem()] };
    const [firstPlan] = createGenerationPlan(definition, { outDir: tempDir });
    fs.mkdirSync(path.dirname(firstPlan.outputPath), { recursive: true });
    fs.writeFileSync(firstPlan.outputPath, "audio");
    const catalog: GeneratedSoundscapeCatalog = upsertCatalogEntry(
      emptyGeneratedCatalog(),
      catalogEntryFromPlanItem(firstPlan, "2026-06-05T00:00:00.000Z", "file-hash")
    );

    const [secondPlan] = createGenerationPlan(definition, { outDir: tempDir, existingCatalog: catalog });

    expect(secondPlan.skipped).toBe(true);
    expect(secondPlan.skipReason).toContain("source hash");
  });

  it("round-trips generated catalog JSON", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kinagent-soundscape-"));
    const catalogPath = path.join(tempDir, "catalog.generated.json");
    const catalog = upsertCatalogEntry(emptyGeneratedCatalog(), sampleCatalogEntry());

    writeJsonAtomic(catalogPath, catalog);

    expect(readGeneratedCatalog(catalogPath)).toEqual(catalog);
  });
});

describe("soundscape generation CLI", () => {
  it("parses dry-run options without executing generation", () => {
    const options = parseArgs(["--dry-run", "--only", "rain_window_soft_01", "--variants", "2"]);

    expect(options).toMatchObject({
      dryRun: true,
      only: "rain_window_soft_01",
      variants: 2
    });
  });

  it("prefers environment API keys over config", () => {
    process.env.ELEVENLABS_API_KEY = " env-key ";
    process.env.KINAGENT_ELEVENLABS_API_KEY = "other-key";

    expect(resolveElevenLabsApiKey(undefined)).toBe("env-key");
  });
});

describe("soundscape audio analysis", () => {
  it("marks effectively silent assets as dead", () => {
    const analysis = analyzeSoundscapeAsset({
      file: "loops/dead.mp3",
      kind: "loop",
      durationSeconds: 30,
      peakDb: -57,
      rmsDb: -72,
      maxWindowRmsDb: -70,
      activePercent: 0,
      strongPercent: 0,
      nearZeroPercent: 96
    });

    expect(analysis.status).toBe("dead");
    expect(analysis.reasons).toContain("effectively silent");
  });

  it("marks low but recoverable beds as weak", () => {
    const analysis = analyzeSoundscapeAsset({
      file: "loops/weak.mp3",
      kind: "loop",
      durationSeconds: 30,
      peakDb: -41,
      rmsDb: -54,
      maxWindowRmsDb: -47,
      activePercent: 50,
      strongPercent: 0,
      nearZeroPercent: 20
    });

    expect(analysis.status).toBe("weak");
    expect(analysis.recommendedGainDb).toBeGreaterThan(8);
  });

  it("summarizes status counts", () => {
    const assets = [
      analyzeSoundscapeAsset({
        file: "loops/dead.mp3",
        kind: "loop",
        durationSeconds: 30,
        peakDb: -57,
        rmsDb: -72,
        maxWindowRmsDb: -70,
        activePercent: 0,
        strongPercent: 0,
        nearZeroPercent: 96
      }),
      analyzeSoundscapeAsset({
        file: "loops/ok.mp3",
        kind: "loop",
        durationSeconds: 30,
        peakDb: -18,
        rmsDb: -33,
        maxWindowRmsDb: -28,
        activePercent: 100,
        strongPercent: 30,
        nearZeroPercent: 5
      })
    ];

    expect(summarizeSoundscapeAnalysis(assets, { outDir: ".local/soundscape/raw" }).totals).toMatchObject({
      total: 2,
      dead: 1,
      ok: 1
    });
  });
});

describe("ElevenLabs sound generation provider", () => {
  it("sends the expected sound effect request without exposing the key in output", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg", "character-cost": "123" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateElevenLabsSound({
      apiKey: "secret-key",
      item: samplePaletteItem(),
      model: "eleven_text_to_sound_v2",
      outputFormat: "mp3_44100_128"
    });

    expect(result.bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.characterCost).toBe("123");

    expect(fetchMock.mock.calls[0]).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, { headers: Record<string, string>; body: string }];
    expect(url.toString()).toContain("https://api.elevenlabs.io/v1/sound-generation");
    expect(url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(init.headers["xi-api-key"]).toBe("secret-key");
    expect(JSON.parse(init.body) as unknown).toMatchObject({
      text: samplePaletteItem().prompt,
      loop: true,
      duration_seconds: 3,
      prompt_influence: 0.3,
      model_id: "eleven_text_to_sound_v2"
    });
  });
});

function samplePaletteItem(): SoundscapePaletteItem {
  return {
    id: "test_loop_01",
    category: "ambience",
    kind: "loop",
    prompt: "A seamless quiet test loop, no voices, no music.",
    durationSeconds: 3,
    loop: true,
    tags: ["test"],
    moodTags: ["calm"],
    environmentTags: ["test-room"],
    volumeDefault: 0.2,
    intensityMin: 0,
    intensityMax: 0.8,
    variants: 1,
    provider: "elevenlabs",
    model: "eleven_text_to_sound_v2",
    license: "elevenlabs-generated"
  };
}

function sampleCatalogEntry() {
  const [plan] = createGenerationPlan(
    { version: 1, items: [samplePaletteItem()] },
    { outDir: ".local/soundscape/raw" }
  );
  return catalogEntryFromPlanItem(plan, "2026-06-05T00:00:00.000Z", "abc123");
}
