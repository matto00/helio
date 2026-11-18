## Why

Four e2e specs failed once each on 2026-11-17 on unrelated PRs and passed on rerun. Every rerun costs a CI cycle and a
driver decision. The CI trace artifacts (downloaded during Planning, before they expire) show that at least one is a
real product race and one is an external-network dependency, not the "read before settle" shape of today's other
flake fixes.

## What Changes

- **hel1578-home-changed-dot:111** — product fix: a dashboard opened (Home shelf card, deep link) while tab hydration
  is still awaiting its change signals is overwritten when hydration finishes and selects its saved active tab. The
  user's later navigation must win. Unit test red first, e2e forced red by delaying the change-signals response.
- **hel813-mobile-touch-target-floor:93** — the shared login helper waits for the window `load` event, which waits on
  the third-party Google Fonts stylesheet. In the trace that request never answered. Login waits for what it uses.
- **hel1668-phone-sheet:184** and **hel1668-schema-panel-copy:172** — root cause by probe (hypotheses in design.md:
  focus or hover lost after a tap while the step sheet/editor is still settling). Fix the test or the product per
  the probe; if no cause reproduces, document what was tried and keep it a named candidate (AC4).
- Every fixed spec is forced red, then passes 40/40 with `--repeat-each=40 --workers=2`.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dashboard-tabs`: a navigation the user makes while tab hydration is in flight is not overridden by hydration.

## Non-goals

- No retries, sleeps or longer timeouts anywhere.
- No change to Popover / ActionsMenu positioning (HEL-1750 owns it).
- Not removing every `waitUntil: "load"` in the suite; only the shared login path. A wider sweep is a follow-up.
- Self-hosting the web fonts.

## Impact

- `frontend/src/features/dashboards/tabs/hydrateTabs.ts` (+ unit test).
- `e2e/support/isolateLivePage.ts` (`uiLogin`), the four specs and their support files as the probes dictate.
- Possibly a small product change in the phone step sheet or compact spine, if a probe shows a product defect.
