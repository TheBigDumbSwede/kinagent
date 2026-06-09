# Kinagent Browser Bridge Extension

This is the browser-side half of Kinagent's native messaging bridge.

For local Chromium testing:

1. Run Kinagent from a signed install or a local build with the native host built.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Load this folder as an unpacked extension.
5. Copy the extension ID into Kinagent's Browser panel and register the native host.
6. Open `https://kindroid.ai/`, then use the Browser panel's connection test buttons.

The content script is limited to `https://kindroid.ai/*`. It receives only local Kinagent bridge commands and does not read or transmit page content.
