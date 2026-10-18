## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ba60f9d81d8c4e3c322afc4f8ae738728b0626c2` against the live-resolved base `d8387507734f8e74bbf62df8880923791ec7c08d` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/pipeline-spine-container-width/HEL-1608`.

Evidence dir (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1608/evidence/.concertino/scratch/HEL-1608/` (files prefixed `skf-`, plus `skeptic-final-e2e-targeted.log`). No claim here rests on mtime ordering.

### What I verified (with evidence)

**Diff scope.** The product change is CSS only: `PipelineSpineLayout.css` (the track is now `clamp(180px, max(34cqi, min(240px, 100cqi - 320px)), 340px)` and `.spine-body__spine` is the named container `spine-column`), `PipelineSpine.css` (one `@container spine-column (max-width: 226px)` block) and two comment fixes in `PipelineSpineHeader.css`. The tests are the hel1579 sweep extension and a new `e2e/hel1608-spine-count-overlap.spec.ts`. There is no TSX change.

**AC1: every title is readable at 769–1100 in both themes, with the list at default and max.**
- My fresh targeted e2e run passed: `hel1608-spine-count-overlap`, the whole hel1579 spec and all four hel1582-* specs. Result: **37 passed, 2 skipped (slow-lane maximal sweeps), exit 0**, with 2 workers, nice 19 and `--trace retain-on-failure` (`skeptic-final-e2e-targeted.log`).
  - The sweep test at :395 now asserts every trunk and lane title on an 8px grid, in both themes, with the list at 248 and at 400. It checks `unoccluded && (full || visible >= 60)`, and it still runs its HEL-1579 header, editor and no-scroll checks.
  - The :174 accent test also passed in this run.
- In the live app, in-page measurements matched the sweep's metric:
  - 769px, list 248: spine 180px (compact). Visible titles were Filter 99px, Sort 99px, lane "Limit rows" 79px and Compute 99px. All are unoccluded, and the document does not scroll.
  - 769px, list 400 (page 313px): the same title widths. The main column is 133px, which is identical to the base at this width because the track floor is unchanged at 180 (`skf-dark-769-list400.png`).
- Screenshots show the titles readable in light and dark at 769, 900, 1024 and 1100: `skf-light-769.png`, `skf-light-900-spine.png`, `skf-dark-900-spine.png`, `skf-light-1024.png`, `skf-light-1100.png`, `skf-dark-1100.png`.

**AC2: the red proof fails on the prior CSS.**
- This is self-authenticating from the commit topology. `git diff d83875077 389792b50 --stat` shows that the red commit touches only `e2e/hel1579-pipeline-spine-layout.spec.ts`, so `red-proof.txt` was produced against unchanged HEL-1579 CSS. That file reads "769px dark list=default: step title unreadable -- 'Step 1: Filter rows, 14 rows' visible 22px", which matches the ticket's measured 21px.
- I corroborated it independently in the live app. I deleted the `@container spine-column` rule from the CSSOM, restored `clamp(180px, 22vw, 340px)` and removed the container. At 769 the titles then render as "F", "S" and "C", and the lane "Limit rows" title is fully gone (`skf-dark-769-basecss-sim.png`, compare with `skf-dark-769.png`).
- `red-proof-2.txt` (a 42px count/summary overlap) covers the cycle-1 compact rules. The evaluator's mutation check of it is consistent with the grid placement I read in the CSS.

**AC3: at 1280×800 the spine is 331.8px (in range), 10 preview rows are fully visible, and the document scroll is [0,0]** (`skf-dark-1280x800.png`). The menu is `position: static` there, so the layout is not compacted. The sweep also asserts 270–340 at 1280 for each theme.

**C2: the phone layout (≤768) is unchanged.**
- At 390 the page has 0 elements with container-name `spine-column` and 4 `.spine-row--phone` rows. Each row's select is `display: flex`, so the compact rules cannot apply.
- The screenshots match the HEL-1582 layout in both themes (`skf-dark-390.png`, `skf-light-390.png`).
- All hel1582-* specs are green, including the 768 sweep.

**C3: the hel1579 edit is confined.**
- The diff hunks are at @@401, @@421, @@429 and @@482. All of them are inside the "sweep 769-1100px" test, which runs from :395 to the end of the describe.
- The `seedPipeline` definition (:20) is untouched. The only change there is the call-site argument `seedPipeline(page, true)`.
- The :174 accent test is untouched.

**Keyboard and pointer behavior of the hidden ⋮ (769, compact).**
- Clicking the lane row and pressing Tab focuses "Step actions for Limit rows", whose menu becomes `opacity: 1; pointer-events: auto`.
- When not hovered, the menu is `opacity: 0; pointer-events: none`.
- On hover it sits on the `--app-surface-raised` row tone (`skf-light-769-hover-lane.png`).

**Unnamed `@container` leakage.** The only unnamed container queries are in `PipelineSpineHeader.css`, the filter-condition rows in `PipelineSpineLayout.css` and `PaletteSearchBox.css`. None of these target elements inside `.spine-body__spine`.

**DESIGN.md.**
- The new rules use only tokens (`--space-2`, `--app-radius-sm`, `--app-bg`, `--app-surface-raised`, `--app-accent-dim`/`-mid`).
- The selected/hover rungs reuse the existing non-compact ladder, which runs from `.spine-row__select:hover` to `--app-surface-raised` and from selected to `--app-accent-dim`/`-mid`.
- The only literal is the 226px container threshold, which is a layout breakpoint and not a spacing value.
- Light and dark are consistent.

**Static gates (fresh).** `check:e2e-types` exit 0. Prettier `--check` on the 2 spec files and 3 CSS files is clean. ESLint `--max-warnings 0` on both specs exits 0. I relied on the evaluator's pasted jest, lint, typecheck and build output for the full suites; the frontend change is CSS-only.

### Verdict: CONFIRM

### Non-blocking notes
- **Non-monotonic title width around the compaction threshold.** At 1024 (track about 245px, compact) "Compute column" shows in full. At 1100 (track about 271px, not compact) it truncates to "Compute col…", because the ⋮ and the count reserve width again (`skf-light-1024.png` vs `skf-light-1100.png`). It is still readable (about 95px), so AC1 holds. A slightly higher threshold, or keeping the overlaid ⋮ up to about 300px, would smooth this out.
- In compact mode the selected row's ⋮ is no longer permanently visible, while the source and output cards in the same column keep theirs. This was accepted in design D2, but it is a small inconsistency in the column.
- The lane label "Lane 1 · from 2 Sort rows" wraps at the 180px track. This predates the change (it is the same in the base-CSS simulation).
- Housekeeping:
  - The evaluator left two `hel1608-eval*-pipe` pipelines on the dev account.
  - `evaluation-2.md` is untracked in the worktree.
  - My `browser_snapshot` calls added files under the main checkout's existing `.playwright-mcp/` directory.
  - The dev account's preferences are unchanged: I emulated the list width through an inline CSS variable, never PATCHed it, and restored the theme localStorage to `dark`.
- My first e2e attempt queued behind HEL-1620's full suite on the e2e lock. The verified run is a targeted, non-full run with 2 workers under nice 19, with the 1-minute load at 7.27 at start.
