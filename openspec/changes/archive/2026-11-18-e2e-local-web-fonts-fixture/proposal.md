## Why

A Google Fonts request that never answers holds the page `load` event open, so any `page.goto` (360 in `e2e/`, all
but ten waiting for `load`) can time out on a third-party stall (HEL-1754, hel813:93). Only `uiLogin` was fixed.

## What Changes

- A local, committed copy of the exact Google Fonts CSS responses the app requests (`frontend/app.html`,
  `frontend/index.html`) and every font file they reference (Fraunces, Schibsted Grotesk, JetBrains Mono; SIL OFL
  1.1, licence texts committed alongside), served by a local HTTPS server the Playwright config starts.
- The shared Playwright config points every browser's fonts hosts at that server (Chromium switches), so every spec
  and every context gets the real web fonts with no network and no per-spec edit, and without request interception.
- Unknown fonts URLs fail the run; a guard fails when the app's font URLs or referenced files drift from the copy.
- A red-first spec: with the upstream fonts hosts stalled, a bare `page.goto` is red without the mechanism and green
  with it, and all three web faces rasterise.

## Capabilities

### New Capabilities

- `e2e-web-font-isolation`: e2e browser runs never depend on the third-party fonts hosts, and still render the real
  web fonts.

### Modified Capabilities

(none)

## Impact

- `playwright.config.ts` and `e2e/` only (list in design.md, for concurrent lane HEL-1744). No app code, no backend,
  no migration, no model calls.

## Non-goals

- Changing the app's font loading, or self-hosting fonts in production.
- Changing any spec's `waitUntil` or assertions.
- Fixing hel1665:437 (HEL-1758 showed it is not the fonts stall).
