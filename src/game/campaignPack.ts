import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config/types.js";

const stringArraySchema = z.array(z.string().trim().min(1)).default([]);

const campaignClueSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  tags: stringArraySchema.optional()
});

const campaignNpcSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  pressure: z.string().trim().min(1).optional(),
  tags: stringArraySchema.optional()
});

const campaignLocationSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  sensoryPalette: stringArraySchema.optional(),
  soundscapeHints: stringArraySchema.optional(),
  tags: stringArraySchema.optional()
});

const campaignThreatSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  motivation: z.string().trim().min(1).optional(),
  powers: stringArraySchema.optional(),
  weaknesses: stringArraySchema.optional(),
  attacks: stringArraySchema.optional(),
  notes: stringArraySchema.optional(),
  tags: stringArraySchema.optional()
});

const campaignHookSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  tags: stringArraySchema.optional()
});

const countdownStageSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  text: z.string().trim().min(1)
});

const mysteryMonsterSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  instinct: z.string().trim().min(1).optional(),
  weaknesses: stringArraySchema.optional()
});

const mysteryEntrySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  hook: z.string().trim().min(1),
  truth: z.string().trim().min(1),
  monster: mysteryMonsterSchema.optional(),
  countdown: z.array(z.union([z.string().trim().min(1), countdownStageSchema])).default([]),
  clues: z.array(z.union([z.string().trim().min(1), campaignClueSchema])).default([]),
  threatIds: stringArraySchema.optional(),
  locationIds: stringArraySchema.optional(),
  npcIds: stringArraySchema.optional(),
  keeperHints: stringArraySchema.optional(),
  revealPolicy: z.string().trim().min(1).optional(),
  automationSafety: stringArraySchema.optional()
});

const campaignHermesHintsSchema = z
  .object({
    keeperPrompts: z.string().trim().optional(),
    moveDetectionHints: z.unknown().optional(),
    soundscapeHints: z.unknown().optional()
  })
  .optional();

const campaignPackSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  genre: z.string().trim().min(1).optional(),
  tone: stringArraySchema,
  rulesetStyle: z.string().trim().min(1),
  recommendedGroupSize: z.string().trim().min(1).optional(),
  contentWarnings: stringArraySchema,
  license: z.string().trim().min(1),
  attribution: z.string().trim().min(1).optional(),
  mysteries: z.array(mysteryEntrySchema).min(1),
  npcs: z.array(campaignNpcSchema).default([]),
  locations: z.array(campaignLocationSchema).default([]),
  threats: z.array(campaignThreatSchema).default([]),
  hooks: z.array(campaignHookSchema).default([]),
  hermes: campaignHermesHintsSchema
});

export type CampaignPack = z.infer<typeof campaignPackSchema>;
export type MysteryEntry = z.infer<typeof mysteryEntrySchema>;
export type CampaignClue = z.infer<typeof campaignClueSchema>;
export type CampaignNpc = z.infer<typeof campaignNpcSchema>;
export type CampaignLocation = z.infer<typeof campaignLocationSchema>;
export type CampaignThreat = z.infer<typeof campaignThreatSchema>;
export type CampaignHook = z.infer<typeof campaignHookSchema>;

export interface LoadedCampaignPack extends CampaignPack {
  source: "builtin" | "local";
  sourcePath?: string;
}

export interface CampaignPackSummary {
  id: string;
  title: string;
  genre?: string;
  tone: string[];
  rulesetStyle: string;
  recommendedGroupSize?: string;
  contentWarnings: string[];
  license: string;
  attribution?: string;
  source: "builtin" | "local";
  mysteries: Array<{
    id: string;
    title: string;
    hook: string;
    countdownStages: number;
    clueCount: number;
    threatCount: number;
  }>;
  threatCount: number;
}

export function loadCampaignPacks(config: AppConfig): LoadedCampaignPack[] {
  const directories = campaignPackDirectories(config);
  ensureCampaignPackDirectories(directories);
  const localPacks = directories.flatMap((directory) => loadLocalCampaignPacks(directory));
  return dedupeCampaignPacks([...builtinCampaignPacks(), ...localPacks]);
}

export function summarizeCampaignPack(pack: LoadedCampaignPack): CampaignPackSummary {
  return {
    id: pack.id,
    title: pack.title,
    genre: pack.genre,
    tone: pack.tone,
    rulesetStyle: pack.rulesetStyle,
    recommendedGroupSize: pack.recommendedGroupSize,
    contentWarnings: pack.contentWarnings,
    license: pack.license,
    attribution: pack.attribution,
    source: pack.source,
    mysteries: pack.mysteries.map((mystery) => ({
      id: mystery.id,
      title: mystery.title,
      hook: mystery.hook,
      countdownStages: mystery.countdown.length,
      clueCount: mystery.clues.length,
      threatCount: mystery.threatIds?.length ?? pack.threats.length
    })),
    threatCount: pack.threats.length
  };
}

export function validateCampaignPack(value: unknown, input: { source: "builtin" | "local"; sourcePath?: string }) {
  const parsed = campaignPackSchema.parse(value);
  return {
    ...parsed,
    source: input.source,
    sourcePath: input.sourcePath
  } satisfies LoadedCampaignPack;
}

export function campaignPackDirectories(config: AppConfig): string[] {
  return [path.join(path.dirname(path.resolve(config.bridge.sqlitePath)), "campaigns")];
}

function ensureCampaignPackDirectories(directories: string[]): void {
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function loadLocalCampaignPacks(directory: string): LoadedCampaignPack[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return loadCampaignPackDirectory(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        return loadSingleCampaignPackFile(entryPath);
      }
      return [];
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function loadCampaignPackDirectory(directory: string): LoadedCampaignPack[] {
  const manifestPath = path.join(directory, "campaign.json");
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const manifest = readJsonRecord(manifestPath);
  const pack = {
    ...manifest,
    mysteries: readJsonDirectory(path.join(directory, "mysteries")),
    npcs: readJsonDirectory(path.join(directory, "npcs")),
    locations: readJsonDirectory(path.join(directory, "locations")),
    threats: readJsonDirectory(path.join(directory, "threats")),
    hooks: readJsonDirectory(path.join(directory, "hooks")),
    hermes: readHermesHints(path.join(directory, "hermes"))
  };

  return [validateCampaignPack(pack, { source: "local", sourcePath: manifestPath })];
}

export function loadSingleCampaignPackFile(filePath: string): LoadedCampaignPack[] {
  return [validateCampaignPack(readJsonObject(filePath), { source: "local", sourcePath: filePath })];
}

function readJsonDirectory(directory: string): unknown[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const value = readJsonObject(path.join(directory, entry.name));
      return Array.isArray(value) ? value : [value];
    });
}

function readHermesHints(directory: string): unknown {
  if (!fs.existsSync(directory)) {
    return undefined;
  }

  const keeperPromptsPath = path.join(directory, "keeper-prompts.md");
  return {
    keeperPrompts: fs.existsSync(keeperPromptsPath) ? fs.readFileSync(keeperPromptsPath, "utf8").trim() : undefined,
    moveDetectionHints: readOptionalJson(path.join(directory, "move-detection-hints.json")),
    soundscapeHints: readOptionalJson(path.join(directory, "soundscape-hints.json"))
  };
}

function readOptionalJson(filePath: string): unknown {
  return fs.existsSync(filePath) ? readJsonObject(filePath) : undefined;
}

function readJsonObject(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const value = readJsonObject(filePath);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Campaign pack manifest must be a JSON object: ${filePath}`);
  }
  return value as Record<string, unknown>;
}

function dedupeCampaignPacks(packs: LoadedCampaignPack[]): LoadedCampaignPack[] {
  const seen = new Set<string>();
  return packs.filter((pack) => {
    if (seen.has(pack.id)) {
      return false;
    }
    seen.add(pack.id);
    return true;
  });
}

function builtinCampaignPacks(): LoadedCampaignPack[] {
  return [
    validateCampaignPack(
      {
        id: "prairie-saints-and-municipal-ghosts",
        title: "Prairie Saints and Municipal Ghosts",
        genre: "urban prairie horror",
        tone: ["rain-soaked", "municipal decay", "paranormal investigation"],
        rulesetStyle: "pbta-mystery-hunt",
        recommendedGroupSize: "2-5 hunters",
        contentWarnings: ["body horror", "drowning imagery", "missing persons"],
        license: "original-app-authored-content",
        attribution: "Kinagent sample campaign pack.",
        mysteries: [
          {
            id: "the-thing-in-the-floodway",
            title: "The Thing in the Floodway",
            hook: "People vanish near drainage tunnels after heavy rain.",
            truth: "A parasitic water-spirit has nested in the floodway infrastructure.",
            monster: {
              name: "The River Husk",
              type: "parasite-haunt",
              instinct: "To hollow out living hosts and return them to the water.",
              weaknesses: ["salted fire", "spoken names of the drowned", "dry ground consecrated by memory"]
            },
            countdown: [
              {
                id: "first-sign",
                label: "First Sign",
                text: "A small public warning hints that the danger is already present."
              },
              {
                id: "first-loss",
                label: "First Loss",
                text: "Someone connected to the infrastructure disappears."
              },
              {
                id: "false-return",
                label: "False Return",
                text: "A changed survivor or trace returns where it should not."
              },
              {
                id: "system-shift",
                label: "System Shift",
                text: "The city system starts behaving against its normal rules."
              },
              {
                id: "public-crisis",
                label: "Public Crisis",
                text: "The threat spills into an inhabited place."
              },
              {
                id: "final-breach",
                label: "Final Breach",
                text: "The threat opens the way for a broad catastrophe."
              }
            ],
            clues: [
              { id: "locked-basement-water", text: "Muddy water stands inside a locked basement." },
              { id: "static-phone", text: "A victim's phone is full of static near standing water." },
              { id: "salt-crystals", text: "Salt crystals cling to a storm drain grate." }
            ],
            threatIds: ["river-husk"],
            locationIds: ["floodway-underpass"],
            npcIds: ["night-maintenance-crew"],
            keeperHints: ["Let clues arrive through physical traces before exposition."],
            revealPolicy: "Reveal the monster truth through discovered clues, not direct narration.",
            automationSafety: ["Do not resolve hunter choices without a user or Kin response."]
          }
        ],
        threats: [
          {
            id: "river-husk",
            name: "The River Husk",
            kind: "monster",
            motivation: "Pull living hosts back into the water system.",
            powers: ["waterborne pressure", "host mimicry"],
            weaknesses: ["salted fire", "spoken names of the drowned", "dry ground consecrated by memory"]
          }
        ],
        locations: [
          {
            id: "floodway-underpass",
            name: "Floodway Underpass",
            description: "Concrete, sodium light, wet gravel, and water moving where it should not.",
            sensoryPalette: ["wet concrete", "distant traffic", "cold standing water"],
            soundscapeHints: ["dripping water", "low tunnel resonance"]
          }
        ],
        npcs: [
          {
            id: "night-maintenance-crew",
            name: "Night Maintenance Crew",
            role: "bystanders",
            pressure: "They know the tunnels are wrong but need the overtime."
          }
        ],
        hooks: [
          {
            id: "missing-worker",
            text: "A city maintenance worker missed checkout after inspecting floodway pumps."
          }
        ],
        hermes: {
          keeperPrompts:
            "Keep the horror practical and local. Advance pressure through municipal systems, missing-person traces, and weather."
        }
      },
      { source: "builtin" }
    )
  ];
}
