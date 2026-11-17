# HEL-1723: e2e: card reads the loading skeleton can satisfy (hel1681, hel1575-dashboard-tabs) and a count-0 check that passes before mount (hel1028)

## Description

HEL-1633 made the e2e specs wait out the panel-grid loading skeleton before they measure `.react-grid-item`. It added `waitForPanelGrid` in `e2e/support/panelGridReady.ts`. It did not cover two other weak reads:

* **Bare `.panel-grid-card` counts and `.first()` reads.** The skeleton renders that class at desktop and phone widths, so these reads can match a skeleton card instead of a real one. Known sites: `e2e/hel1681-refresh-control.spec.ts` :332 and :343, and `e2e/hel1575-dashboard-tabs.spec.ts`. The full list of 73 hits is in the second grep of `openspec/changes/archive/2026-11-16-wait-out-panel-skeleton/sweep.md`.
* `e2e/hel1028…:310` **asserts a count of 0.** It passes before anything has mounted, so it proves nothing.

## Acceptance criteria

- [ ] Every `.panel-grid-card` read in the sweep is either converted to wait for the real grid, or justified line by line in a sweep record.
- [ ] hel1028:310 waits for a mounted state before it asserts 0, and a mutation shows it can now fail.

## Agent notes

Found by the HEL-1633 lane (merged d9c6585a8, PR #1120); recorded in its sweep.md. HEL-1644 (merged d60b1f799) changed `hel1575-dashboard-tabs.spec.ts`; check what it changed before starting. Line numbers date from 2026-11-16.

## Driver context (claims, verified at Planning)

- HEL-1724 (ab6cc9416) added `waitForPanelStack` / `LIVE_STACK_ITEMS` (phone) to `e2e/support/panelGridReady.ts` next to `waitForPanelGrid` / `LIVE_GRID_ITEMS` (desktop). Reuse, do not duplicate. VERIFIED.
- The skeleton fades out hidden/inert before it unmounts, and its stubs share the grid cell with the real cards. VERIFIED (panelGridReady.ts header, Crossfade).
- Lane HEL-1692 may touch `e2e/hel1681-refresh-control.spec.ts`; keep any hel1681 change minimal and say so in the PR. Lane HEL-1711 owns `e2e/hel1685-draft-polish.spec.ts`: do not edit it.
