## Skeptic Report — final gate (round 2, skeptic-final-2.md)

- **Reviewed HEAD:** `05a5634d041fd2be1d0a8b1745a227c6b833aae1`. HEAD was unchanged when I finished, and the worktree was clean.
- **Diff base:** resolved live with `resolve-review-base.sh` as `29b39995a741fd34931e1c5b121c8539b2f7fd21`.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/motion-foundation-primitives/HEL-1573`.
- **Durable evidence:** under `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/` (written `<ev>/` below).

### What I verified (with evidence)

**Gates (my own fresh runs in WORKTREE_PATH, nice 19)**
- `npm run lint`, `typecheck` and `format:check` all printed EXIT=0.
- Prettier `--check` on the e2e and DESIGN.md files is clean.
- `tsc -p e2e` is clean.
- jest at 2 workers: 648 suites and 7667 tests passed, EXIT=0 (`<ev>/sk2-jest.txt`).
- e2e under the e2e flock at 2 workers: **84 passed, EXIT=0** (`<ev>/sk2-e2e-c3.txt`). This is the C3 scope:
  - both hel1573 specs: the 4 modes x 2 themes matrix, the grid C2 checks, the chart entrance and no-replay C1 check, and the new shrink test;
  - the existing layout, chart-fit, table-overflow and mobile specs: hel1023 breakpoint layout, hel1398 and hel1444 footnoted/narrow chart canvas, hel1510 table overflow, hel1512 category axis, hel813 mobile touch targets, hel1304 chart types, hel1392 remount staleness, hel909 picker/panel sheet, hel1305 time axis.
- The executor's `e2e-C3-layout-sweep.txt` contains only "122 passed (8.0m)" and names no specs. I did not rely on it; my run replaces it.

**Skeptic-final-1 CR1 (the Crossfade sizing fix)**

The fix is `.crossfade__layer > * { min-width: 0 }` (`Crossfade.css:19-23`). I tested it on the running app (7005/9912) with a seed that has a metric, bar and line charts, a 16-column table, markdown, image and form panels.

| route | theme | result |
| --- | --- | --- |
| Original route 1900 → 1600 → 1900 | dark | Line canvas 466 → 576 → 466, bar 726 → 576 → 726. Every canvas right edge ≤ its card edge. |
| Original route 1900 → 1600 → 1900 | light | Line 479 → 596 → 479, no overflow. |
| Narrowing route 2500 → 1900, same lg breakpoint | dark | Line 666 → 466 and bar 1026 → 726, both fit. |
| Narrowing route 2500 → 1900, same lg breakpoint | light | Line 679 → 479, bar 496 → 346, both fit. |
| In-grid user resize narrower (SE handle, -350px) | — | Bar card 768 → 388 wide, canvas 726 → 346, fits. |
| Widening the dashboard list (container narrows, crosses into md) | — | Fits. |

Screenshot: `<ev>/sk2-light-1900-after-shrink.png`.

**Can the regression test go red? Yes. I demonstrated it myself without touching code.**
- **Mutant:** in the live page I injected `.crossfade__layer > * { min-width: auto !important }`, which restores the pre-fix layout, then ran the test's own route, 2500 → 1900.
  - The line canvas stayed at 666 with its right edge at 1275, past the card's 1096.
  - The bar canvas stayed at 1026, right edge 2155 > 1876.
  - Screenshot: `<ev>/sk2-dark-mutant-overflow.png`.
- **Recovery:** removing the mutant made both shrink back to fit within 1.5s.
- **The executor's claim about the original route is corroborated.** With the same mutant, the 1900 → 1600 → 1900 route did not overflow on my seed either: line 576 → 466 even under `min-width: auto`. The lg↔md breakpoint switch re-lays the charts out, so a narrowing *within* one breakpoint is the route that exercises the defect. Choosing 2500 → 1900 for the test is therefore correct, not a dodge.
- **The executor's red log agrees:** `red-C3-crossfade-overflow-on-HEAD.txt` shows "M-fit Chart: canvas right 2305 > card 1876".
- **Limits:**
  - The test runs in light theme only. Layout does not depend on theme, and I checked dark manually.
  - Its table check is the `.panel-content` edge. Wide tables scroll inside `.ui-data-grid` (clientWidth 722 vs scrollWidth 2880), in both the grid card and the fullscreen overlay.

**Blast radius of wrapping every panel body (C3)**

| surface | result |
| --- | --- |
| Desktop grid, every kind (metric, chart, table, markdown, image, form) | The Crossfade box equals the body box, and the body fills its card. Screenshot `scratch/HEL-1573/sk2-light-all-kinds.png`. |
| Fullscreen overlay (`panel-fullscreen-overlay__body`, column flex) | Chart canvas 1158x782 equals its host. The table scrolls inside. |
| Panel detail modal view body | Same column-flex pattern as the card (`PanelDetailModal.css:98`). |
| Output editor preview | Does not use `PanelContent` or `Crossfade` (grep), so it is unaffected. |
| Mobile stack (390px) | Every body is 300 wide inside a 326-wide item. |
| Public viewer (`/dashboards/:id/panels?token=`) | No overflow. |

For the mobile stack and the public viewer I also compared against a "base" simulation. I flattened the wrappers in the live page (`.crossfade, .crossfade__layer { display: contents }`), which puts `.panel-content` back as a direct child of the card, as it was before this change. Every body and canvas size was identical to HEAD. The two oddities I saw in those surfaces are therefore pre-existing, not caused by this diff (see notes).

**AC trace (whole change)**
- **AC1 (tokens):**
  - `theme.css` adds `--motion-duration-move` and `--motion-rise-distance`, with Off, OS-reduce and Subtle overrides.
  - `motion.css`, `Crossfade.css`, `PanelGrid.css` and the JS primitives take timing only from `var(--motion-*)` or `readMotionDuration`/`readMotionEasing`. `motionPrimitiveLiterals.test.ts` passes in the green jest run.
- **AC2 (Off and OS-reduce, real browser, both themes):** `hel1573-motion-primitives.spec.ts:267` passed in all 8 mode x theme combinations in my run. The evaluator's mutant reds (`eval3-*`) show the assertions can fail.
- **AC3 (unit test and real consumer for each primitive):**

  | primitive | consumer |
  | --- | --- |
  | stagger | DashboardList |
  | layout slide | DashboardList |
  | value tween | MetricRenderer |
  | Crossfade | PanelContent |
  | indicator | AppRail and SegmentedRadioGroup |

  Every primitive has its own `*.test.tsx`.
- **AC4 (grid):**
  - In `PanelGrid.css`, the container, the items and the placeholder all use `--motion-duration-move` plus ease-out, by specificity (C2).
  - The dragging and resizing none-states are re-asserted.
  - The grid C2 tests passed, including the swapped stylesheet order.
- **AC5 (chart):**
  - `useChartEntranceMotion` plus `applyChartMotion`.
  - `hel1573-motion-grid-chart.spec.ts:103` passed. It checks that the entrance runs in 150–600ms (not 1000), that a refresh does not collapse the bars, that the applied `animationDuration` is 0 after the entrance, and that a series-type change does not replay it.
  - Covers C1.
- **One reader:**
  - `useMotion()` (`ThemeProvider.tsx`) is the only React reader, and `useReducedMotion` derives from it.
  - The diff adds no `matchMedia` call and no JS read of `data-motion` (grep of the added lines). The only `matchMedia` hit is a jest mock.
- **Cross-lane with HEL-1575:**
  - Under `grid/`, only `PanelGrid.css` and its CSS test changed.
  - The diff touches no `PanelGrid.tsx`, `DesktopPanelGrid.tsx` or tab-strip file.
  - Nothing changes how react-grid-layout receives layouts, breakpoints, children or keys.
- **DESIGN.md §10:**
  - It is accurate against the code for HEL-1584: the APIs, attributes, `INSTANT_AT_OR_BELOW`, and where the token reads happen.
  - Both round-1 corrections landed: the emphasized rise is explicitly future work, and the move token is documented as resolving at `:root`.
  - The Crossfade fill mode is now `backwards`, so a settled body keeps no fill.
- **Feel against `Motion.dc.html` and `MotionLive.dc.html`:**
  - The boards use the same `cubic-bezier(.3,.9,.4,1)`, a 30–50ms stagger, a 4–8px rise and 280–420ms durations. The implementation's 280ms ease-out, 40ms stagger and 6px rise sit inside that band.
  - The grid reflow at 280ms reads as "a little give", and drag and resize track the pointer (the e2e asserts both).
  - I have no objection on feel.
- **HEL-1032 and HEL-1034 can be closed as superseded.**
  - HEL-1032: one duration for container, items and placeholder; the feel judgment is recorded in `5.4-drag-resize-feel-note.md`.
  - HEL-1034: the entrance is set explicitly to the token; the entrance does not replay on option change; Off and OS-reduce are honoured through `useMotion`.

### Verdict: CONFIRM

### Non-blocking notes
- **Pre-existing, not caused by this diff (both confirmed by the flatten simulation), worth spinoffs:**
  - (a) A `form` panel collapses to about 26px in the mobile stack. `MobilePanelStack.css:54-62` lists no `--form` in its intrinsic-height kinds, so the `container-type: size` collapse applies. Screenshot: `<ev>/sk2-light-mobile-full.png`.
  - (b) In the public viewer, chart bodies render 24px tall. The row is an auto-height column flex, so the chart's `height: 100%` has no definite base. Screenshot: `<ev>/sk2-public-head.png`.
- **Fullscreen overlay warning:** opening it logs ECharts' "Can't get DOM width or height". The chart mounts in the child's mount phase, before `Modal`'s parent `useEffect` calls `showModal()`, so this is pre-existing and not related to Crossfade.
- **Stale entering class:** `crossfade__content--entering` stays on the content layer after the fade. It is harmless with the `backwards` fill, but a later consumer that keys styles off the class would see a stale state.
- **DESIGN.md §10 Crossfade:** consider one clause noting that the layer is a row flex container whose child gets `min-width: 0`. A HEL-1584 consumer whose body is not `flex: 1` would otherwise be surprised by its width.
- **Unrelated console error:** a 502 on `/api/pipelines/<id>/run-events` (SSE through the proxy).
- **Throwaway data**, all under user `sk1573-1792180169471@example.test` (id `9b607a20-1ca7-4b90-9831-6e34c208476a`) on 7005/9912's shared dev DB:
  - dashboard `SK2 Fit` (`5e421f5d-d8b2-420d-a24b-2799f3a3cb4e`), with 7 panels, a layout edit and one share token (`4d39b9eb-d5f4-4a86-8289-de9ebd74ba61`);
  - data sources `SK2 source` (`aa1392c0-…`) and `SK2 form ds` (`4a3988c6-…`);
  - pipeline `SK2 pipeline` (`978e8745-…`) with 4 Outputs.
  - The e2e users were auto-deleted ("deleted 84 recorded throwaway user(s)").
