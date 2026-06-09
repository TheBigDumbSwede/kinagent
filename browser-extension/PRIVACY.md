# Kinagent Browser Bridge — Privacy Policy

**Effective date:** 2026-06-09

The Kinagent Browser Bridge extension ("the extension") is a companion to the
open-source [Kinagent](https://github.com/TheBigDumbSwede/kinagent) desktop
application. This policy explains exactly what the extension does and does not do
with data.

## Summary

**The extension does not collect, store, sell, or transmit any personal data.**
It has no analytics, no tracking, and no remote server of its own. It communicates
only with the Kinagent desktop application running locally on the same computer.

## What the extension accesses, and why

- **Local native messaging (`nativeMessaging`).** The extension's only data channel
  is a connection to the locally installed Kinagent desktop app via the native
  messaging host `com.kinagent.bridge`. It sends simple presence/poll messages
  (`browser-ready`, `poll`) and receives display requests (`show-notice`,
  `reload-kindroid`). This traffic never leaves your computer.
- **Kindroid tab access (host access to `https://kindroid.ai/*`).** The
  extension locates your open Kindroid tab so it can (a) display a small on-page
  status notice (for example, "Kinagent is connected") and (b) reload the tab when
  the desktop app requests it. The extension does **not** read, store, or transmit
  the contents of the page, your messages, your account, or your browsing history.

## Data sharing

None. The extension does not send any data to the developer or to any third party.
There is no server, database, or analytics endpoint associated with this extension.

## Permissions and data-use certifications

- The extension's use of permissions is limited to the single purpose described
  above.
- The extension does **not** sell or transfer user data to third parties.
- The extension does **not** use or transfer user data for purposes unrelated to
  its single purpose.
- The extension does **not** use or transfer user data to determine
  creditworthiness or for lending purposes.

## Open source

The full source code of the extension and the desktop application is publicly
available at <https://github.com/TheBigDumbSwede/kinagent>. You can verify every
claim in this policy by reading the code.

## Contact

Questions about this policy can be raised as an issue on the project repository:
<https://github.com/TheBigDumbSwede/kinagent/issues>.
