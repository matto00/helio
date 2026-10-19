## Standing Constraints

- [C1] Run constraints: jest and Playwright at most 2 workers, heavy runs under `nice -n 19`; full Playwright suite under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`, `sbt testFull` under the same dir's `sbtfull.lock`; before a heavy run, if the 1-minute load > 10 sleep 60 s and recheck (up to 30 min); Bash `timeout: 600000` on long calls; Playwright `--trace retain-on-failure`; never kill/pkill/pgrep/killall or signal any process; stop servers only with `scripts/concertino/stop-servers.sh`; screenshots and scratch files in `/home/matt/Development/helio/.concertino/scratch/HEL-1656/`, never /tmp or the repo root; delete any test users/data you create by exact id.

## 1. Shared motion helpers

- [x] 1.1 Extract the velocity sample window + `velocityOf` from `useSheetSwipe.ts` into `shared/motion/dragVelocity.ts`; `useSheetSwipe` uses it (behaviour-preserving; existing BottomSheet tests green). Unit tests.
- [x] 1.0 Register every new `shared/motion` file (`dragVelocity.ts`, `usePullToRefresh.ts`, and `motionTransition.ts` if created) in `PRIMITIVE_FILES` in `motionPrimitiveLiterals.test.ts`; no literal durations/delays/easings in them (the 15 s safety cap lives in `features/panels/ui/grid/pullRefreshRegistry.ts`, not shared/motion).
- [x] 1.2 Export a generalised transition-end helper and `settleOffset` from `sheetMotion.ts` (or a sibling file); `settleSheet` delegates to it. Token-timed only.

## 2. Gesture hook

- [x] 2.1 `shared/motion/usePullToRefresh.ts` per design D1/D3/D6 (touch events, slop 6px, top-only, single touch, vertical-dominant, nested-scroller and form-control exclusions, non-passive touchmove preventing only when engaged, damping 0.5, cap 112, threshold 64, flick rule, `data-pull-refresh` attribute lifecycle, viewport gate via `useIsNarrowerThan(769)`).
- [x] 2.2 jest tests for every engagement rule and the attribute lifecycle, each with a recorded red mutation.

## 3. Stack integration

- [x] 3.1 `PullRefreshRegistry` (`features/panels/ui/grid/pullRefreshRegistry.ts`) + registration in `MobileStackPanelBody` for output-bound panels only (D5): change-only notifications, seen-true-then-false busy rule, `PULL_REFRESH_TIMEOUT_MS` ceiling; second pull while busy ignored.
- [x] 3.2 `PullRefreshIndicator` (D4, aria-hidden, unrendered at rest) + the always-mounted visually-hidden status region and stack wiring in `MobilePanelStack.tsx`; Full follow + token settle; Subtle/Off/reduced snap with no transform; no transform at rest.
- [x] 3.3 CSS in `MobilePanelStack.css`: scoped containment rule (D6), indicator styles from existing tokens; no hover-only styles outside `@media (hover: hover)` (HEL-1668 guard).
- [x] 3.4 jest: release refreshes each output-bound panel once, none for non-output panels, none on a short pull; busy holds while a rows request is held open and ends after it resolves; status region announces Refreshing then Refreshed; each with a recorded red mutation.

## 4. Docs

- [x] 4.1 DESIGN.md §10 + §12 entries (D8).

## 5. Verification

- [x] 5.1 `e2e/hel1656-pull-to-refresh.spec.ts` per D7 (CDP touch at 375 and 390; request counts; no pipeline-run request; containment computed style on phone dashboard vs Home vs 1280; Motion Off no transform; no detail modal after a pull; desktop no indicator). (`e2e/shard-weights.tsv` is NOT hand-edited: a new spec gets the default weight.)
- [x] 5.2 Screenshots at 375 and 430, light and dark, Full and Off, resting / pulling / busy states, plus desktop 1280 unchanged, saved under the scratch dir.
- [x] 5.3 Gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm --prefix frontend test` (2 workers), the new e2e spec and the hel1583/hel1584/hel1646/hel1668 mobile specs.
