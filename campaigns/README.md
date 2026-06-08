# Campaign Packs

This directory holds distributable Group Gaming campaign pack source.

Committed packs live under `campaigns/packs/<pack-id>/` and use the same split directory format accepted by the app's
local importer:

- `campaign.json`
- `mysteries/*.json`
- `npcs/*.json`
- `locations/*.json`
- `threats/*.json`
- `hooks/*.json`
- `hermes/keeper-prompts.md`
- `hermes/move-detection-hints.json`
- `hermes/soundscape-hints.json`

Generated downloads are written under `release/campaigns/`, which is ignored by Git.

Useful commands:

```sh
npm run campaigns:check
npm run campaigns:build
```

Release builds upload campaign pack zips and `campaign-index.json` as separate GitHub Release assets beside the Windows
portable app. Campaign packs are not bundled into the app executable; users download a pack zip and import it from the
Group `Gaming` tab.
