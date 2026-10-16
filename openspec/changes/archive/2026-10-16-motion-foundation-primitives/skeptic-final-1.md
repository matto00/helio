## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2f0900b8fd8de528dd5af913b553e0b38e219c75`. The diff base was resolved live with `resolve-review-base.sh`: `29b39995a741fd34931e1c5b121c8539b2f7fd21`. The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

**Gates (my own fresh runs in WORKTREE_PATH)**
- `npm run lint`, `typecheck` and `format:check` all pass (exit 0).
- jest at 2 workers under `nice -n 19`: 648 suites and 7665 tests passed, EXIT=0. The log is `/home/matt/Development/helio/.concertino/scratch/HEL-1573/skeptic-jest.txt`.
- I did not re-run the 44 affected e2e tests. I rely on the evaluator's pasted output (`eval3-e2e-affected.txt`: 44 passed), which is unambiguous. That scope is part of the problem: see CR3.

**AC trace (code)**
- **AC1 (tokens):**
  - `theme.css` adds `--motion-duration-move` and `--motion-rise-distance`, with overrides for Subtle, Off and OS-reduce.
  - The primitives read timing only through `readMotionDuration` / `readMotionEasing` or `var(--motion-*)`.
  - There are no literal durations in `shared/motion/**`, `Crossfade.css` or `PanelGrid.css`. `motionPrimitiveLiterals.test.ts` is in the green jest run.
- **AC2 (Off / OS-reduce, real browser, both themes):**
  - `e2e/hel1573-motion-primitives.spec.ts` runs 4 modes × 2 themes.
  - `expectInstantOrStill` checks that there are no moving records longer than 0.01ms and no WAAPI calls.
  - Full is a control on the same selectors, so the check can go red. The evaluator's mutant reds (Off stagger with a 280ms literal, OS-reduce WAAPI) are recorded in evidence.
  - I accept this as able to fail.
- **AC3 (unit test and consumer for each primitive):**

  | primitive | consumer |
  | --- | --- |
  | stagger | DashboardList |
  | layout slide | DashboardList |
  | value tween | MetricRenderer |
  | Crossfade | PanelContent |
  | indicator | AppRail and SegmentedRadioGroup |

  Every primitive has a `*.test.tsx`.
- **AC4 (grid):**
  - `PanelGrid.css` is the only file under `grid/` in the diff.
  - Container, items and placeholder all use `--motion-duration-move` with specificity overrides, and the none-states are re-asserted.
  - There are no `PanelGrid.tsx` / `DesktopPanelGrid.tsx` edits and no tab-strip files in the diff, so the HEL-1575 cross-lane constraint holds.
- **AC5 (chart):**
  - `applyChartMotion` plus `useChartEntranceMotion`. The entrance window is a state-held mutable object, so closing it never re-renders. `animationDuration` drops to 0 after the window closes.
  - The real-browser spec `hel1573-motion-grid-chart.spec.ts:103` covers the entrance and the no-replay case.
- **One reader:**
  - `useMotion()` is in `ThemeProvider.tsx`, and `useReducedMotion` derives from it.
  - The diff adds no `matchMedia` call and no JS read of `data-motion`. Only the existing CSS attribute-selector pattern is used.
- **DESIGN.md §10:**
  - The primitive APIs match the code: the signatures, `data-motion-key`, `data-indicator-active`, the `hidden/snap/ready` states, and `INSTANT_AT_OR_BELOW`.
  - One claim is slightly over-stated (see notes): it says "A panel or card rise would use `--motion-duration-emphasized`", but `.motion-enter` hard-wires `--motion-duration-standard` and has no hook for another duration.

**UI in the running app (7005/9912, Full, light and dark)**
- **Rail indicator wash:** correct in both themes. The settings screenshots show it in dark (`scratch/HEL-1573/sk-dark-settings.png`).
- **Segmented indicator:** correct in both themes.
- **Metric, table and the panel menu:** overlay correctly.
- **Defect, reproduced twice:** after any panel gets narrower, the chart canvas stays at its old width and overflows the card.
  1. I loaded the dashboard at 1900px. The charts fit (Line: card 508, canvas 466).
  2. I resized to 1600px (md, wider cards). The canvas grew to 576 and 702.
  3. I resized back to 1900px. The cards are 508 and 638 again, the `.crossfade__layer` is 466 and 596, but the **canvas stays at 576 and 702**. The line chart's gridlines run past the card edge to the viewport edge, and the bar chart's last bar is clipped at the card border.
  - Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/openspec/changes/motion-foundation-primitives/skeptic-final-chart-overflow-after-shrink.png`
- **Root cause, confirmed by probe:**
  - `Crossfade` puts the panel body inside `.crossfade__layer { display: flex }`, which is a row flex container.
  - `.panel-content` (`PanelContent.css:1-8`) is `flex: 1` with `min-height: 0` but no `min-width: 0`. As a row-axis flex item its `min-width: auto` clamps it to its min-content width, which is the stale echarts canvas. The element never shrinks, so echarts' ResizeObserver never sees a smaller size.
  - Before this change `.panel-content` was a child of the card's column flex box, where a cross-axis stretch tracks the container width.
  - Computed chain: `.panel-content` has `min-width: auto` and width 576, inside a layer of width 466.
  - Injecting `.crossfade__layer > * { min-width: 0 }` in the live page made both charts shrink to fit within 1.5s (canvas 466 and 596).
  - This affects every panel type whose content has a wide min-content (charts after any shrink, and likely wide tables that should scroll internally). Panels shrink often: a breakpoint change, expanding the context list, a user resize, the browser window.

### Verdict: REFUTE

### Change Requests

1. **Fix the Crossfade layer sizing regression.**
   - Files: `frontend/src/shared/ui/Crossfade.css` (`.crossfade__layer`, around lines 12-17).
   - The layer must not impose a row-axis min-content floor on its child. Either make the layer a column flex container so the body stretches on the cross axis as it did before, or give the layer's child `min-width: 0`.
   - Then confirm on the running app: load at 1900px, resize to 1600px, resize back to 1900px. Every chart canvas must be ≤ its card's content width. Check a wide multi-column table too: it must scroll inside the panel, not overflow it.
2. **Add a real-browser regression test that can go red.**
   - Shrink a mounted chart panel (a viewport resize across the lg/md boundary and back, or a grid resize narrower) and assert that the canvas width is ≤ the panel body width.
   - Show it red on the current HEAD and green after CR1.
   - jsdom cannot prove this.
3. **Widen the e2e scope to match the blast radius.**
   - `Crossfade` now wraps every panel body (`PanelContent`), so this is a layout change to every panel type, not a motion-only change.
   - Run the existing panel layout, chart-fit and table-overflow specs alongside the hel1573 specs: the HEL-1613 layout sweep specs, and any spec asserting chart or table fit inside a card.
   - Paste the output.

### Non-blocking notes
- **Crossfade fill mode:** `.crossfade__content--entering` uses fill `both`. The finished animation therefore persists (`getAnimations()` returns a `finished` animation forever) and keeps an opacity stacking context on every panel body. `motion-enter` deliberately uses `backwards` for exactly this reason; `backwards` would match.
- **DESIGN.md §10 over-states the panel rise:** the line "A panel or card rise would use `--motion-duration-emphasized`" describes something the primitive does not provide. HEL-1584 should not read it as an API. Either add an override hook (for example a `--motion-enter-duration` defaulting to standard) or reword it as future work.
- **`--motion-duration-move` is a computed alias:** it is `var(--motion-duration-standard)` resolved at `:root`. Overriding `--motion-duration-standard` on a subtree will not retime "move". That is worth one sentence in §10 for HEL-1584.
- **HEL-1032 and HEL-1034 supersession:** on the code, the grid CSS and the chart entrance/no-replay both honestly cover these. Close them once CR1-3 land.
- **Feel against the boards:** I checked the stagger, indicators and grid at 280ms on ease-out in Full. They read as "a little give, not decoration" and are consistent with Motion.dc.html and MotionLive.dc.html. I have no objection on feel.
- **Unrelated console error:** the browser logged one console error, a `502` on `/api/pipelines/<id>/run-events` (an SSE stream through the proxy). It is not related to this diff.
- **Housekeeping:** I seeded throwaway data (dashboards `SK *`, one pipeline and source) under the existing evaluator session user on 7005/9912. I used no isolated DB.
