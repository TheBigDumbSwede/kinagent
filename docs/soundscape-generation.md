# Soundscape Asset Generation

Kinagent soundscapes are intended to run from local, app-owned audio assets. The ElevenLabs generator in this repo is an internal asset factory: it creates and caches loops and one-shot cues ahead of time, then writes a catalog the runtime can consume later. The app should not call ElevenLabs during ordinary chat monitoring or playback.

## Files

- `scripts/soundscape/soundscape-palette.definition.json` defines the source palette.
- `scripts/soundscape/generate-elevenlabs-palette.ts` generates assets from the palette.
- `.local/soundscape/raw/loops/` receives raw loopable ambience.
- `.local/soundscape/raw/cues/` receives raw short one-shot effects.
- `.local/soundscape/raw/catalog.generated.json` records generated files, source hashes, prompts, categories, tags, and default mix metadata.

Generated audio files should be reviewed before being distributed. Murmur and crowd items need extra review to confirm they contain no intelligible words.

## API Key

The generator looks for an ElevenLabs key in this order:

1. `ELEVENLABS_API_KEY`
2. `KINAGENT_ELEVENLABS_API_KEY`
3. `voice.elevenlabs.apiKey` from `config.yaml`

The key is only used by the generation script. It is not copied into the generated catalog, logs, or runtime assets.

## Dry Run

Use dry-run first. It validates the palette and prints the planned outputs without calling ElevenLabs.

```powershell
npm run soundscape:generate -- --dry-run
```

Generate a single item plan:

```powershell
npm run soundscape:generate -- --dry-run --only rain_window_soft_01
```

## Generate Assets

Generate one asset:

```powershell
npm run soundscape:generate -- --only rain_window_soft_01
```

Generate the full palette:

```powershell
npm run soundscape:generate
```

Regenerate even when the existing file and catalog hash match:

```powershell
npm run soundscape:generate -- --force
```

Generate more variants than the palette default for a pass:

```powershell
npm run soundscape:generate -- --variants 2
```

By default the generator skips files whose catalog source hash still matches the palette prompt, duration, loop flag, model, and output format. Changing those source fields causes the item to be planned again.

## Palette Rules

- Loops are capped at 30 seconds because ElevenLabs sound effects are short-form generation.
- Loop prompts should ask for seamless background ambience, no music, no melody, no speech, and no sudden foreground events.
- One-shot prompts should ask for isolated effects without a background bed.
- Crowd and cafe murmur prompts must ask for indistinct non-verbal texture and should be manually reviewed.
- `volumeDefault`, `intensityMin`, `intensityMax`, `cooldownMs`, and `probability` are mix hints for future playback, not guarantees enforced by the generator.

## Runtime Boundary

This script prepares assets only. Playback should read curated normalized assets from `assets/soundscape-normalized/`, select local files by scene tags and intensity, and mix them in Hermes soundscape playback. It should not use the ElevenLabs API as a live effect source.

## Analyze Generated Assets

After generation, run the analyzer to find files that are effectively silent, weak, usable, or too hot:

```powershell
npm run soundscape:analyze
```

The report is written to:

```text
.local/soundscape/raw/analysis.generated.json
```

The analyzer measures decoded audio locally and reports peak level, RMS level, active-window percentage, near-zero samples, status, reasons, and a recommended gain adjustment. It does not call ElevenLabs.

To also stamp each catalog entry with the analysis result and recommended gain:

```powershell
npm run soundscape:analyze -- --write-catalog-analysis
```

Use the catalog annotation when the runtime is ready to consume `entry.analysis.recommendedGainDb`. Until then, the separate report is safer because it does not mutate the generated catalog.

## Normalize For Audition

To create normalized copies from the current analysis report:

```powershell
npm run soundscape:normalize -- --force
```

The original generated files stay in `.local/soundscape/raw/`, which is ignored by Git and remains on the dev machine. Normalized MP3 copies are written to:

```text
assets/soundscape-normalized/
```

The normalizer applies each asset's measured `recommendedGainDb` from `analysis.generated.json`, including attenuation for hot cues. It also writes `assets/soundscape-normalized/normalization.generated.json` so the applied gain is inspectable.
