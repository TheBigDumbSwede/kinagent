# Chrome Web Store listing — reference copy

Submission-ready text for the Kinagent Browser Bridge extension. Paste these into
the matching fields in the Chrome Web Store Developer Dashboard. Not shipped with
the extension; kept here for reference and reuse.

Published Chrome Web Store listing:
https://chromewebstore.google.com/detail/kinagent-browser-bridge/cggbaonfbomoejmmmomapjmejacmbpon

Published Chrome / Edge extension ID:
`cggbaonfbomoejmmmomapjmejacmbpon`

---

## Product name

```
Kinagent Browser Bridge
```

## Summary (short description — 132 character max)

```
Connects Kindroid browser tabs to the local Kinagent desktop app to show status notices and reload the tab on request.
```

## Category

Productivity (alternative: Developer Tools)

## Detailed description

```
Kinagent Browser Bridge is a companion extension for the open-source Kinagent
desktop application. It links your Kindroid browser tab to the Kinagent app
running on the same computer so the app can:

  • show a small status notice on the Kindroid page (for example, when Kinagent
    connects), and
  • reload the Kindroid tab when you ask Kinagent to refresh it.

That is the extension's entire job. It talks only to the local Kinagent desktop
app over Chrome's native messaging — it has no server, no analytics, and no remote
network connections of its own. It does not read your messages, your account, or
the contents of the page; it only displays notices sent by the local app and
reloads the tab on request.

This extension does nothing on its own. It requires the Kinagent desktop
application (Windows) to be installed and registered as a native messaging host.
Without the desktop app it simply stays idle. Source code for both the extension
and the desktop app is available at:
https://github.com/TheBigDumbSwede/kinagent
```

## Single purpose statement (Privacy tab)

```
Connects Kindroid tabs in the browser to the locally installed Kinagent desktop
app, allowing the app to display a small on-page status notice and reload the
Kindroid tab on request.
```

## Permission justifications (Privacy tab)

**`nativeMessaging`**

```
The extension's sole function is to communicate with the user's locally installed
Kinagent desktop application through Chrome native messaging (host
"com.kinagent.bridge"). It sends a local protocol handshake, presence/poll
messages, and command acknowledgements, then receives display and reload
requests. No data is sent to any remote server.
```

**Host permission `https://kindroid.ai/*`**

```
The content script runs only on kindroid.ai to display a small status notice
(such as "connected" or "reloading") sent by the local desktop app. It does not
read, collect, or transmit any page content.
```

## Data use disclosures (Privacy tab)

- Data collected: **None.**
- Certify: does **not** sell or transfer user data to third parties.
- Certify: does **not** use or transfer user data for purposes unrelated to the
  single purpose.
- Certify: does **not** use or transfer user data to determine creditworthiness
  or for lending.

## Privacy policy URL

Host `browser-extension/PRIVACY.md` and link it here. Options:

- GitHub Pages (recommended for a clean URL), or
- the raw file URL:
  `https://raw.githubusercontent.com/TheBigDumbSwede/kinagent/main/browser-extension/PRIVACY.md`

## Notes for reviewers

```
This extension is a companion to the open-source Kinagent desktop application and
does nothing on its own. It connects via Chrome native messaging to a local host
("com.kinagent.bridge") that is installed and registered by the Kinagent desktop
app (Windows). If the desktop app is not present, the extension cannot connect; it
polls, finds no host, and remains idle — it does not error or affect browsing.

There is no remote backend. All communication is local-only between this extension
and the desktop app on the same machine. The content script runs only on
kindroid.ai and only renders a small status notice; it does not read or transmit
page content.

Because the host requires the Windows desktop app, the connected behavior cannot
be exercised in a sandbox review environment. Full source for the extension, the
native host, and the desktop app is public:
https://github.com/TheBigDumbSwede/kinagent
```

## Recommended distribution visibility

**Unlisted.** This is a desktop-companion tool, not a standalone product. Unlisted
keeps it out of search while still giving it a stable ID and auto-updates; share
the install link from the project README.

## Submission checklist

- [ ] Extension `manifest.json` version bumped (currently 1.0.2)
- [ ] Zip the _contents_ of `browser-extension/` (manifest at zip root; exclude
      `PRIVACY.md` / `STORE_LISTING.md` / `README.md`)
- [ ] At least one screenshot (1280×800 or 640×400)
- [ ] Privacy policy URL set and reachable
- [ ] Permission justifications pasted
- [ ] Reviewer notes pasted
- [x] After publishing: copy the Web Store-assigned extension ID into the Kinagent
      desktop Browser panel and re-register the native host (the published ID
      differs from the unpacked dev ID)
