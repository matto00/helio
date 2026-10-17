## Run rules (binding on every task; from the driver brief)

- Scratch: ONLY `/home/matt/Development/helio/.concertino/scratch/HEL-1584/` (absolute). Playwright `outputDir` goes there.
  Never write a relative `scratchpad/`, never write elsewhere in the main checkout, never delete the scratch folder.
  Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/`.
- Load gate before any heavy command: if the 1-min value in `/proc/loadavg` is above 10, sleep 60s and re-check (up to 30 min).
- Full Playwright suites: `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock <cmd>`;
  full `sbt testFull`: `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock <cmd>`.
  jest and Playwright at most 2 workers; heavy work under `nice -n 19`; Playwright traces only on failure.
- Never signal any process; never use pkill/pgrep/killall (read-only included) — use `/proc` or `ps -p`. Stop servers only
  with `scripts/concertino/stop-servers.sh`.
- Throwaway users on the shared dev DB are deleted by exact id (`buildUserDeleteSql`) before you finish; report ids.
- Long Bash calls (commit, test suites) use `timeout: 600000`. No claude.ai session link or Claude-Session trailer anywhere.
- Never invoke npm/vite/playwright bare against default ports: dev server on 7016, backend on 9923 (this run's ports).

## 1. Performance baseline (before any source change)

- [x] 1.1 Write `e2e/hel1584-motion-perf.spec.ts` (D13): 12-panel seeded dashboard, Full; React commit counter via
  `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` init script; `PerformanceObserver` for `layout-shift` and `longtask`;
  cold dashboard load (commits, CLS, long-task total, time to first card content) and a scripted three-cell drag (commits,
  rAF frame interval p50/p95/max). Verify: the spec runs green against the unmodified tree.
- [x] 1.2 In this worktree, before any source change, run it 5× and `e2e/hel1575-switch-measurement.spec.ts` 5× (warm and
  cold); record medians and min-max spreads in `.concertino/runs/HEL-1584/evidence/perf.md` ("before"). Verify: file has
  before medians and spreads for every D13 metric.
- [x] 1.3 Add a jest `<Profiler>` test pinning `DesktopPanelGrid`'s commit count across one drag start/stop and the initial
  mount, at the base values. Verify: green on base.

## 2. Tokens and primitives

- [x] 2.1 `theme.css`: `--motion-lift-scale: 1.01`, `--motion-nudge-distance: 2px`, neutralised (1 / 0px) under Subtle, Off
  and OS reduce (D1). Pin in `appearanceTokens.css.test.ts`. Verify: test red before the CSS, green after.
- [x] 2.2 `shared/motion/useKeyedEntrance.ts` (`entranceOf` → phase + index, never a className) and the flow-list helper
  `entranceClassProps` + tests (D3); `motion.css` gains `.motion-pop` and `.motion-enter--emphasized`. Verify: unit tests for
  latch, order, later pop/none, no replay, returning key, no className from `entranceOf`; `motionPrimitiveLiterals` green.
- [x] 2.3 `shared/motion/expandFrom.ts` (a function, D8) + tests. Verify: `animate` called once with the computed transform on an
  open element; never when the element is not open; never for a null origin or instant token; `fill` is `none`.
- [x] 2.4 `shared/motion/useOneShot.ts` + tests (D11). Verify: never fires on mount; fires once on change into target;
  resets after `done`.
- [x] 2.5 `Crossfade` options `contentFade`, `block` and `keepContentMounted` (with the painted-skeleton rule) + tests (D5/D6).
  Verify: pending layer `inert`, `aria-hidden`, invisible; resolve before the first frame → no entering class and no fade;
  resolve after → both fades; `contentFade={false}` → no entering class; `block` → block layers; existing tests green.

## 3. Grid (item 1, items 3 grid crossfade) — PanelGrid/DesktopPanelGrid touch, gate-signed

- [x] 3.1 `PanelGrid.css` lift/settle (D2). Verify: `PanelGrid.css.test.ts` extended for the new rules; HEL-1573 grid e2e
  (`hel1573-motion-grid-chart.spec.ts`) still green.
- [x] 3.2 `panelsSlice` `itemsOrigin` + `loadId` (D4) + slice tests; `shared/motion/useFirstMountForToken.ts` + tests.
  Verify: `fetchPanels`/`duplicateDashboard`/`importDashboard` fulfilled → "network" and `loadId` + 1; `panelsRestored` →
  "restored", `loadId` unchanged; token check true once per token across unmount/remount, every token seen while mounted recorded, StrictMode-safe.
- [x] 3.3 `PanelList` → `PanelGrid` (latches `playEntrance`, clears it on a shell swap) → `DesktopPanelGrid`/`MobilePanelStack`;
  reading order at the active breakpoint; `data-entrance` + `--motion-index` on the item wrapper, animation on the card
  (D4). Verify: component tests (network load: `data-entrance="enter"` in (y,x) order; restored: none; added panel: `pop`;
  width crossing `sm`: no replay; mount → unmount → remount with the same store: no replay; refetch while mounted → unmount → remount: no replay; new `loadId` that arrived while no grid for that
dashboard was mounted: plays; fresh mount with one panel: `enter`; **no `.react-grid-item` carries `motion-enter`/`motion-pop`**); HEL-1575 key invariant
  and `DesktopPanelGridSkeleton.dashboardSwitch.test.tsx` green; no change to layouts/breakpoint/cols/width/handlers/keys.
- [x] 3.4 `PanelList` Crossfade (`loading={showPanelGridSkeleton || showBootstrapSkeleton}`, `contentFade={false}`, `block`)
  inside the always-mounted zoom container (D5). Verify: component test; real-browser width check at 1440 and 375 (grid
  root and mobile stack as wide as the zoom container); HEL-1575 switch spec green with the D13 expected move recorded.

## 4. Modals (item 4) and palette (item 5)

- [x] 4.1 `Modal.css` backdrop fade, rise on `--motion-rise-distance`, Subtle `ui-modal-fade-in` (D7); keep `ui-modal-in`
  name and `backwards`. Verify: `Modal.css.test.ts` extended; motion token guard green.
- [x] 4.2 `Modal` `expandFrom` prop (render-time `ui-modal--expanding`, call after `showModal()` in the sync-open effect);
  `PanelCard` `data-panel-id`; origin rect capture on click and Customize paths (desktop and mobile); pass-through to
  `PanelDetailModal` (D8). Verify: unit tests — class on first render under Full; `animate` never while `dialog.open` is
  false; both capture paths.
- [x] 4.3 Palette entrance CSS and per-open keyed results stagger (D9). Verify: CommandPalette tests (stagger classes on open,
  none for per-keystroke additions, re-staggers on re-open); existing palette tests green.

## 5. Refresh (item 2) and feedback (item 7)

- [x] 5.1 Series ids in `chartDataOptions.ts`; `ChartPanel` data-stripped whole-option signature → `notMerge`/`replaceMerge`
  (D10). Verify: unit tests: same-shape data refresh → merge; every type switch → notMerge; same type with an axis `name`
  or `min` removed → notMerge; recreated formatter with identical source → merge; existing chart snapshot tests updated
  only for added `id` fields (each diff explained).
- [x] 5.2 `ComparisonLine` delta tween (D10). Verify: test mirrors the headline tween tests (SR text final value only).
- [x] 5.3 `layoutSaveSeq`/`panelSaveSeq` in the slices; `SaveStateIndicator` check on a save success (D11a). Verify: tests —
  save fulfilled → check with `motion-pop`; undo to clean → no check; `resetPanelSaveState` → no check; mount → none.
- [x] 5.4 `TimelineMark` failed nudge (D11b). Verify: test running→failed adds nudge once; mounted-failed never.
- [x] 5.5 File the follow-up for the stale "Last saved" label after a layout-only save (reported to orchestrator, which files it).

## 6. Docs, guards, proof

- [x] 6.1 DESIGN.md §10: new tokens, new primitives' APIs, the surfaces list, Subtle/Off behaviour per surface, the
  `notMerge` merge-path note replacing HEL-1573's "future morph must revisit" note. Verify: doc diff.
- [x] 6.2 Guards: update `motionTokenGuard.css.test.ts`'s CSS file count only by the files this change adds (each named in the
  commit message); `check-tokens.mjs` allowlist only if a JS-set property is added. Verify: guards green.
- [x] 6.3 `e2e/hel1584-motion-surfaces.spec.ts` (D14): Off and OS-reduce (motion null) × light/dark on grid, modal, palette:
  no transform/position animation > 0.01ms; Full control animates (must be failable); Subtle opacity-only; warm switch no
  entrance; dashboard → Home → dashboard: no entrance on the second visit; add a panel, wait for its refetch to land, → Home → back: no entrance; a lazily loaded route page (e.g. the proposal
  review route) is as wide as its outlet at 1440 and 375; chart same-shape refresh animates under Full. Verify: spec green; a mutation (e.g. drop the Off token for lift)
  turns it red — record the red run in evidence.
- [x] 6.4 Run the perf spec and `hel1575-switch-measurement` 5× each on the branch head ("after"); add medians, spreads and
  deltas to `perf.md` against every D13 threshold, naming each extra commit. Verify: every threshold met (a miss is a FAIL).
- [x] 6.5 Screenshots of grid lift, modal expand mid-frame, palette open, save check, in both themes, compared against
  `/home/matt/Development/helio/.concertino/design/HEL-1570/screenshots/Motion*.png` and `MotionLive*.png`; saved to evidence.
- [x] 6.6 Full gates: lint, typecheck, format, frontend jest (≤2 workers), affected e2e specs (flocked) — must stay green:
  `hel1573-motion-*`, `hel1575-*`, `hel1311-*`, `hel510-*`, `hel716-panel-detail-tall-viewport-footer`, `hel909*`, `hel572*`,
  `hel1572-appearance-preferences`, palette specs; delete throwaway users by exact id.
- [ ] 6.7 PR body names the reversible decisions for the owner: drag lift
  shadow token; modal backdrop fades (HEL-1035's question 1).

## Standing Constraints
