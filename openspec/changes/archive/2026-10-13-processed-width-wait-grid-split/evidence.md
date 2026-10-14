# HEL-1418 evidence

## Probe

Temporary, never committed (reverted with `git checkout e2e/support/auth.ts`): `registerAndLogin` added an init
script wrapping `window.ResizeObserver` so every callback is delivered via `setTimeout(cb, RO_DELAY_MS)`, enabled by
`RO_DELAY_MS=900` (the HEL-1413 probe). Dev servers via `start-servers.sh` (DEV_PORT 6850, BACKEND_PORT 9757).

## Expected width: where it comes from (stated once)

The caller passes the grid CONTAINER width; the helper never reads it from the DOM. hel1023 passes the container of its
explicit window table; hel1392-burst and hel1275 derive it with the helper's pure `containerWidthForViewport(vw)`
(vw >= 1056 ? vw - 288 : vw - 40, the rule in hel1023's header). Verified: hel1392 DESKTOP 1400 -> 1112 (the observed
box and processed width below).

## 2.2 hel1023 (pure refactor, same-result evidence only)

`settledRects` now calls `waitForGridWidth` (the lifted l.260-274 logic); its container box poll stays as an assertion
ahead of it. Before (origin/main spec) and after both pass; after: `5 passed (28.3s)` no probe, `5 passed (1.1m)` with
`RO_DELAY_MS=900`.

## 2.3 Red probes of the OLD waits (before editing each spec)

### hel1392-remount-request-burst `crossTo` (old: `toMatch(/^\d+px$/)`)

- Old spec, `RO_DELAY_MS=900`, unmutated app: `3 passed (2.1m)` -> **no red obtained**. Observation (temporary log after
  the old wait, in the "within seconds" test): `processed= 1112px box= 1112 viewport= 1400`. Reason: phone->desktop
  mounts a FRESH `DesktopPanelGrid` whose `useState(width)` initialises `processedWidth` to the new mount width, so the
  old regex is not racy for this spec's crossings (only phone<->desktop, never desktop->desktop).
- The old wait still accepts a stale value. Temporary never-committed mutation `useState(width)` -> `useState(0)` in
  `DesktopPanelGrid.tsx` (reverted with `git checkout`), old spec, `RO_DELAY_MS=900`: the test PASSED and the log read
  `processed= 0px box= 1112 viewport= 1400` (old wait resolved on `0px`, a stale value, while the box was already 1112).
  That is a demonstrated weakness of the old wait, not a flake reproduced in the unmutated app.
- New wait, same mutation + probe: FAILED with `Error: grid never processed 1112px (last
  --panel-grid-processed-width: 0px)` (Expected "1112px", Received "0px"). New wait, unmutated app: green with and
  without the probe (`3 passed (1.9m)` no probe; `3 passed (2.0m)` with `RO_DELAY_MS=900`).

### hel1275-metric-delta-sparkline `resizeAndSettle` (old: card box width differs from pre-resize, then 4 equal reads)

- Old spec, no probe `2 passed (20.2s)`; `RO_DELAY_MS=900` run 1 `2 passed (25.3s)`, run 2 `2 passed (22.4s)` -> **no
  red obtained**. Probe visibly active (tests ~2-3 s slower per test). Reason: an RGL item box only changes once RGL
  has received the new width, so "card width differs" already waits for width delivery, and the 4 equal reads span
  >= ~250 ms, longer than the 200 ms item transition. Migrated as refactor-with-tightening (exact processed width,
  also correct for a no-op resize); no red claimed.
- New: `2 passed (21.6s)` no probe, `2 passed (24.4s)` with `RO_DELAY_MS=900`.

## 2.5 Grep proof

```
$ grep -rn -- '--panel-grid-processed-width' e2e | grep -v e2e/support/gridProcessedWidth.ts | wc -l
0
$ grep -rnE "panel-grid['\"]\)?\.boundingBox|panel-grid.*getBoundingClientRect|container\??\.w" e2e
e2e/hel1023-breakpoint-layout-derivation.spec.ts:251:   .poll(... container?.w ...)   # allowed: the retained box ASSERTION ahead of the helper (D1 option a)
e2e/hel1023-breakpoint-layout-derivation.spec.ts:282:   colW = (container.w - ...)    # allowed: expected-rect arithmetic, not a wait
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:185-187  # allowed: pre-load container-range assertion, no resize
```

(hel1275's comment mentioning the property by name was reworded so the literal count is 0.)

## 3.2 Hook / effect declaration order (DesktopPanelGrid)

Before (origin/main 9c569fc60, 436 lines): effect at l.113 (editingTitleRef sync) -> l.142 (HEL-651 auto-close) ->
l.185 (commit-flag cleanup `useEffect(() => clearCommitFlag, ...)`) -> l.187 `useLayoutSave` (its effects, incl. the
unmount flush) -> `useCallback`s / `useMemo`s (no effects) .

After (196 lines): l.86 `usePanelTitleEditing` (its sync effect, usePanelTitleEditing.ts:17) -> l.87
`usePanelDetailState` (HEL-651 auto-close, usePanelDetailState.ts:31) -> l.108 `useCommitFlag` (cleanup effect,
useCommitFlag.ts:28) -> l.109 `useLayoutSave` -> l.117 `useGridLayoutInteraction` (no effects) -> l.130
`useProcessedWidth` (no effects). Effect order and unmount-cleanup order are identical (commit-timer cleanup still
runs before `useLayoutSave`'s unmount flush). `useLayoutSave`'s outputs go to `useGridLayoutInteraction` as plain
arguments (C3).

`handleStartEdit` home (skeptic note 4): `usePanelDetailState`, built on the title hook's stable `beginTitleEdit`
(`[]` deps); its own deps are `[beginTitleEdit]`, a stable identity, so `PanelCard` props do not change identity.

## 3.3 / 5.1 Split result and unit tests

`DesktopPanelGrid.tsx` 436 -> 196 lines; new hook files 30/144/105/82/23 lines. `git diff --stat` shows no change to
`useLayoutSave.ts`, `dashboardsSlice.ts` or any test file.
`npm test -- --maxWorkers=3 --testPathPatterns='features/panels/(ui/grid|hooks)'`: `Test Suites: 51 passed, 51 total /
Tests: 469 passed, 469 total`. Full frontend jest (the same `npm test` run): `590 suites / 7063 tests passed`.
Browser behaviour of the split: `hel1028` + `hel1457` + `hel1230` e2e `16 passed (44.8s)` (drag/resize/undo, stale-tab
save, drag-then-create).

## 4.1 Archived HEL-1413 evidence.md

l.18 reworded to "all 8 items were at lg geometry, and 4 of them (P2/P4/P6/P8, on the lg right edge) fall outside the
md bounds" (source: archived skeptic-final-1.md l.10-15); l.24 and l.28 unchanged; residue window now ends
`16:04:07` (the newest row of `dev-db-residue.txt`), `16:22:40` kept only as the query bound.

## 5.2 User cleanup

Every Playwright run's `globalTeardown` deleted its recorded throwaway @example.test users by exact id
(`[HEL-1301 e2e] deleted N recorded throwaway user(s)` printed after each run), via
`e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`. No matt@helio.dev use.
