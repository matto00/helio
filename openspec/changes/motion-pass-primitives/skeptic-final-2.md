## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed head: `0cef4c0a5e2fe04f0b6e14e11e52ee00488d3759` (working tree clean). Diff base resolved live:
`29cb0a60f41e72b0a6b26c15a28360c504fffdb8` (`resolve-review-base.sh`, exit 0; this is current `main`, HEL-1583's merge).

### What I verified (with evidence)

**Gates, run fresh by me at 0cef4c0a5**
- `npm run typecheck`: exit 0.
- `npm run lint` (`--max-warnings=0`): exit 0.
- `npm run format:check`: exit 0, "All matched files use Prettier code style!".
- `node scripts/check-tokens.mjs`: OK.
- Full frontend jest, 2 workers, nice 19: **723/723 suites, 9084 tests passed** (172 s).
  ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/jest.txt
- Real browser, under flock, 2 workers, nice 19, DEV_PORT 7016. **89 passed, 0 failed, exit 0 (10.1 min).** Specs run:
  - `hel1584-motion-surfaces`: Off / OS reduce / Subtle / Full × light / dark on grid, modal and palette. This now
    includes the new label-gap and 30 ms-step assertions.
  - `hel1572-appearance-preferences`.
  - `hel1573-motion-primitives`, `hel1573-motion-grid-chart`.
  - `hel503` and `hel516` palette specs.
  - `hel1575-dashboard-tabs`, `-delayed-restore-no-update-loop`, `-reload-after-edit`.
  - `hel1583-refresh-line-no-shift`.

  ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/e2e.txt

  I did not re-run the full 474-test suite. The evaluator's full run was on 11bbc2636. Since then, 0cef4c0a5 touches only
  the palette, one token, perf/surfaces specs and docs, and I re-ran every spec touching those.
- Added-line scan of non-test `frontend/src` for time and easing literals: every hit is a comment, a
  `var(--motion-*)` reference, or a token definition in `theme.css` (allowed).

**Round-1 change requests, against ground truth**
- **CR1, labels enter with their group. Met.**
  - `CommandPalette.tsx` passes the group's first action id to `rowEntrance(..., "eyebrow command-palette__group-label")`.
  - Live, under Full, the labels "Recent", "Navigation", "General" and "Create" carry `motion-enter`. Their
    `--motion-index` values are 0, 1, 6 and 9, and their computed delays are 0, 0.03, 0.18 and 0.21 s. In each group this
    equals the first row's index and delay.
  - A jest test pins the index equality.
  - The surfaces e2e samples label opacity minus first-row opacity on every frame and requires it to stay below 0.05. The
    executor's mutation run (labels without the entrance) failed with `Received: 1`
    (`evidence/red-run-palette-label.txt`), so the guard can fail. It is green in my run.
- **CR2, 30 ms tight stagger token with a palette cap. Met.**
  - `--motion-stagger-tight: 30ms` is defined in `theme.css` `:root`. It is zeroed (`0ms`) in both the Off block and the
    OS-reduce block, and pinned in `appearanceTokens.css.test.ts`, in both the zeroed map and the Full value.
  - The palette rule declares `--motion-stagger-cap: 7` locally. Live delays are 0/30/60/…/180/210 ms, so the last row
    starts at 210 ms and the list settles by about 490 ms (it was about 680 ms).
  - The e2e asserts `[0,30,60,90]` and a maximum delay of 215 ms or less.
- **CR3, perf.md completeness. Met.**
  - SHAs are named. Before = `6a8cf3a32`. After for W1–W6 = between `60b6059bc` and `f931bcc18`, with an explicit
    statement that the merged head was not covered by W1–W6.
  - A new merged-head Window Z is 3-way interleaved: base6a8, main `29cb0a60f`, head `0cef4c0a5`, 5 runs each.
  - Visible delay is now measured, not computed (first card fully visible, last card fully visible).
  - Per-window deltas are restated next to the visible-delay figures.
  - I recomputed Window Z from the persisted `z-*.jsonl`. Every median in perf.md matches:
    - first content: 1853 / 1916 / 2021
    - first visible: 1853 / 1917 / 2088
    - last visible: 2126 / 2226 / 2315
    - long-task total: 479 / 455 / 713
    - commits: 58 / 58 / 56
    - drag commits: 39 in every run

**Investigating the Window Z long-task growth (+258 ms head vs main)**
- Window Z is the only window that used the new instrument. 0cef4c0a5 added a per-rAF `getComputedStyle(card).opacity`
  sampling to the perf spec. Only the head variant has running entrance animations while that sampling runs, so the
  instrument itself was a plausible cause of a head-only long-task increase.
- I tested that hypothesis directly, with no source change. I made two scratch copies of the spec in my scratch folder:
  - (a) the current spec, with the visibility sampling;
  - (b) `git show 11bbc2636:e2e/hel1584-motion-perf.spec.ts`, without it.

  I ran them interleaved on head 0cef4c0a5: 6 runs each, the first discarded as warm-up, 1 worker, nice 19, under flock.
- Results:
  - (a): long-task median **549** ms (475–653), first content 1748.
  - (b): long-task median **583** ms (469–598), first content 1833.
- **The instrument is not the cause.** More usefully, head reproduces today at about 550–580 ms. That matches its W2–W5
  values (524–567) and is well below Z's 713 (Z's head minimum alone was 612).
- I could not re-measure `main` without switching the source tree, which is out of my read-only remit. Even so, Z's +258
  ms is very likely inflated by that window. The head-vs-base long-task cost consistent across windows is about
  +90–150 ms. That is still a D13 miss in the strict reading, and it is the owner's pending perf ruling, not a refute here.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/perfab/a-run2.jsonl … a-run6.jsonl
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/perfab/b-run2.jsonl … b-run6.jsonl
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/perfab/specs/b-novisible.spec.ts
- No correctness defect explains the growth:
  - Load commits are flat (56–58).
  - Drag commits are identical (39).
  - CLS is identical.
  - The known structural cost is the skeleton grid staying mounted for one standard duration (D5), plus the entrance
    animations. Both are the subject of the ablation options already put to the owner.

**Acceptance criteria**
- **AC1 (items 1–5 on the shared primitives and tokens only): met.**
  - Item 1: entrance via `data-entrance` on the grid item wrapper and animation on the inner card; drag lift and settle in
    `PanelGrid.css`; pop on add.
  - Item 2: `chartShapeSignature` and series ids give the morph; `MetricRenderer` tweens the delta.
  - Item 3: `Crossfade` `contentFade={false}`/`block` in `PanelList`, and `RouteSuspense`.
  - Item 4: `expandFrom` plus the Modal backdrop keyframes.
  - Item 5: palette `command-palette-in` and the results stagger, now on the tight token, with labels.
  - The token guards (`motionTokenGuard`, `motionPrimitiveLiterals`, `appearanceTokens`) are green inside the full jest run.
- **AC2 (Off / OS reduce: no transform or position animation on grid, modal or palette): met.** The surfaces spec runs
  Off and `reducedMotion: reduce` in both themes on all three surfaces, with a Full control that must show movement on
  the same selectors. I re-ran it: green.
- **AC3 (no layout-shift or extra re-render regression; dashboard load and drag keep current performance).**
  - Layout shift and re-render: met (CLS identical, commits flat, Profiler pin unchanged).
  - "Keep current performance" on load time: missed by D13's own threshold in some windows. perf.md discloses this
    honestly, and it is the pending owner ruling. Per the brief, I do not refute on it alone. perf.md is now complete
    enough for that ruling (see the CR3 note above and the non-blocking note below).
- **AC4 (items 6–8 built or split with owner agreement).**
  - Item 7: built. The save check and the failed-run nudge are both unit-tested, and the save check is also covered by e2e.
  - Items 6 and 8: proposed for split and escalated. The owner ruling is pending, so this criterion is neither met nor
    refuted here. **Delivery must not merge until the owner answers. Without that answer, AC4's "with owner agreement" is
    unmet.**

**Driver invariants (re-checked on the full diff)**
- `PanelGrid key={selectedDashboardId}` is kept inside `Crossfade` (`PanelList.tsx`). The skeleton's `dashboardId` prop
  and key path are unchanged.
- `DesktopPanelGrid` has no change to `layouts`, breakpoint, cols, compactor or handlers. The only additions are a
  reading-order `useMemo`, `useKeyedEntrance`, and `data-entrance` / `--motion-index` attributes on the wrapper (no
  className).
- `PanelGrid.css` animates `.react-grid-item[data-entrance] > .panel-grid-card`, never the item itself.
- `PanelGrid`'s render-time `setState` on a shell crossing touches only `playEntrance` / `shellIsPhone`. It does not touch
  layouts.
- The diff touches no file under assistant, pipelines, AppRail, the tab strip or the phone nav/chips. `MobilePanelStack`
  only gains entrance classes and the tap origin, with no layout change.

**UI / design judgment (running app, Full, 1600x1000, frames frozen with `getAnimations().pause()` + `currentTime`)**
- Palette at 120 ms (dark): the header and search are in. "RECENT" sits with its row. "NAVIGATION" rises together with
  its first rows, and later rows are still fading. No heading sits orphaned over empty space, which was the round-1
  defect.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/02-palette-dark-120ms.png
- Palette at 300 ms (dark): the list is essentially complete. This reads as the board's quick cascade (MotionLive: 30 ms
  rows, about 330 ms).
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/03-palette-dark-300ms.png
- Palette at 150 ms (light): same structure. The label and row parity holds in light mode.
  - ref=/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/.concertino/scratch/HEL-1584/skeptic-final-2/04-palette-light-150ms.png
- No palette animation has `fill: forwards`. Every finished animation drops off `document.getAnimations()`, so no
  animation lingers after the entrance.
- The grid entrance, drag lift, detail-modal expand and skeleton crossfade are unchanged since round 1, where I judged
  them on screen in both themes and accepted them. 0cef4c0a5 does not touch their code.

Evidence-mtime disclosure: no conclusion here rests on mtime or directory order. Every conclusion rests on:
- recomputed jsonl content;
- `getComputedStyle` and `getTiming()` values read live;
- frames frozen at stated `currentTime` values;
- command output.

### Verdict: CONFIRM

Engineering and design ship. Two conditions belong to the owner, not to this gate: the perf threshold ruling, and the
split of items 6 and 8 (AC4). The orchestrator must not merge before both are answered.

### Non-blocking notes
- perf.md's Method paragraph still says the metric excludes "420 ms with up to 400 ms of stagger" and calls itself a
  "lower bound". The new "Visible delay (measured)" section supersedes this: the entrance runs before data arrives, so
  first visible is +67 ms and last visible equals last content. Mark the Method sentence as superseded, so the owner does
  not read two contradicting claims.
- Add this review's A/B (above) to perf.md or to the PR, next to Window Z. The visibility instrument does not inflate
  long tasks, and head reproduces at about 550–580 ms in a later window. Without that, Z's +258 ms reads as a new
  regression rather than a window-level outlier.
- The palette cap of 7 makes the final six rows of the default list start together at 210 ms. On screen this is a
  coherent block, not a visible clump, and it is what round 1 asked for. Note it only if the owner wants a pure cascade.
- Carry-overs: task 6.7 (PR body: drag-lift shadow token, modal backdrop fade / HEL-1035 Q1); the round-1 notes
  (`--app-shadow-lift`, do not call the 1.01 settle an "overshoot", MetricRenderer intermediate rounding); evaluator S1/S2.
- Throwaway users from this review:
  - `7551f8d4-61e5-45af-bc14-8c3e6f3c7613` (MCP seeding): deleted by exact id and email via `buildUserDeleteSql`.
    `SELECT count(*)` afterwards = 0.
  - The 12 perf A/B runs: one user each, deleted by the registry teardown (12 "deleted 1 recorded throwaway user(s)"
    lines).
  - The e2e run: 93 users deleted by its global teardown.
- Servers on 7016/9923 were stopped with `stop-servers.sh` at the end of this review.
