## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `f931bcc18df706d5fcffaf9dd9a6d8d1394928f6`. Diff base resolved live: `c8e204e065a817babc5ef5a74df8878bb4af73c0`
(`resolve-review-base.sh`). `origin/main` has since moved by two commits (HEL-1628, HEL-1583). `git merge-tree` against
`origin/main` is textually clean. Scope: items 1-5 and 7. Items 6 and 8 wait on the owner's split ruling, which is not a
defect of this cycle.

### Phase 1: Spec Review — PASS

- AC1 (items 1-5 on shared primitives and tokens, with no new literals): met. A grep over every added non-test line in
  `frontend/src` finds no time literal, easing literal or colour literal. `motionTokenGuard` and `motionPrimitiveLiterals`
  are green, and the four new primitives are listed in `PRIMITIVE_FILES`.
- AC2 (no transform or position animation under Off and OS reduce, checked in a real browser): met. See Phase 3.
- AC3 (perf): not met on two D13 metrics. The owner ruling is pending, so this alone does not fail the cycle. The
  evidence package for that ruling has defects (Phase 2, CR1 and CR2).
- AC4: split pending with the owner (D12). Not a defect.
- Tasks 1.1-6.6 are checked and match the diff. 6.7 (PR body) is a Delivery step.
- Driver invariants, each checked:
  - **HEL-1575 keys:** `key={selectedDashboardId}` on `PanelGrid` (PanelList.tsx) and the skeleton `<Responsive key={dashboardId}>`
    (DesktopPanelGridSkeleton.tsx:56) are both still there.
  - **Layouts and breakpoint:** no change to layouts, breakpoint derivation, cols, width, handlers or child keys in
    `DesktopPanelGrid`. The entrance only adds `data-entrance` and `--motion-index` on the wrapper div.
  - **No entrance className on a grid item:** in a real browser, every `.react-grid-item` className is
    `react-grid-item cssTransforms react-resizable-hide react-resizable`.
  - **Untouched areas:** no file under the tab strip, AppRail, pipeline pages, phone nav or chips, or the assistant is in
    the diff. `MobilePanelStack.tsx` changes only the entrance classes and the detail origin, not its layout.
- Executor deviations, checked rather than trusted:
  - **expandFrom StrictMode fix (`expandFrom.ts:383-385`):** the second call cancels the first before measuring. In a real
    browser (dev StrictMode) exactly one `expand-from` Web Animation runs, starting from a real offset:
    `translate(152px, 1777px) scale(0.906667)`.
  - **translateX-then-rotate order (HomePage.css `tl-nudge`):** correct. The translate comes first, so the shake runs
    along the screen's x axis.
  - **Nine re-scoped e2e specs:** only the locator changed (`:not([aria-hidden='true'] *)` / the live crossfade layer). The
    assertions are byte-identical. The hel1573 `rowEnters` filter keeps that spec on its own subject (dashboard-list rows),
    and the Subtle "instant or still" sweep still covers every record.
  - **`buildChartOption.unchangedPath` adjustment:** strips only the ids that `withSeriesIds` added, and keeps the
    pre-existing `__helio_reference_marks__` id.
  - **Optional slice fields:** documented, and readers default them.
  - **hel716/hel909 quarantine:** this is the existing HEL-951 `testIgnore` (commit 7c27b60ad, 2026-09-03), and this branch
    does not modify `playwright.config.ts`. The failure traces in the executor's scratch match the documented quarantine
    reasons: hel716 gets `POST /api/panels` 400 at setup (HEL-961), and hel909 "Untitled Panel" never appears (HEL-963).
    But the file `quarantined-specs-on-base.txt` is mislabelled. Its run config (`scratch/pw-quarantine.config.ts`) points
    at this worktree's `e2e/` and ran at 23:52, after the base/HEAD source switching ended, so it is a HEAD run, not a base
    run. The substantive claim holds; the label does not (Suggestion S3).
- `CONSTRAINTS` in workflow-state.md is `[]`.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in `WORKTREE_PATH` at f931bcc18:

| gate | result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (2 workers) | root 61/61 suites, 524 tests; frontend 712/712 suites, 8972 tests |
| `npm --prefix frontend run build` | exit 0 |
| affected e2e | see below |

The affected e2e run used 2 workers under flock, on ports 7016/9923. It covered hel1584-motion-surfaces, hel1573-motion-*,
hel1575-*, hel1311, hel510, hel572, hel1572, hel503, hel516, and the nine re-scoped specs. Result: **158 passed, 1 skipped**.
The skip is `hel1575-switch-measurement`, which skips itself through its own env gate (`test.skip` at :22). All 28
hel1584-motion-surfaces tests passed: Full, Subtle, Off and OS reduce in both themes; entrance timing; crossfade width at
1440 and 375; chart morph; save check. No known flake (HEL-1633/1644) fired.

Code review: the design is followed closely. Points checked and found sound:
- `useKeyedEntrance` and `useOneShotOnChange` latch with render-time state adjustment, so the latch adds no commit.
- `useFirstMountForToken` has a pure initializer and records in an effect.
- `ShapeMemory` is written only in an effect.
- `echarts-for-react` 3.0.6 forwards `replaceMerge` (`lib/core.js:187`).
- The `panelCardRect` id guard blocks selector injection (`usePanelDetailState.ts:91`).
- The `ReadySignal` layout effect fires only after the lazy chunk commits.
- The `SaveStateIndicator` check is keyed to the success counters, not to "became clean".

**Perf evidence verdict (the orchestrator's question):**

- **The numbers are honestly derived.** I recomputed every window from the raw JSONL:
  - W1, W2, W3 and W6 from `evidence/perf-*.jsonl`.
  - W4 and W5 from `scratch/HEL-1584/x-*.jsonl` and `y-*.jsonl`.

  Every median, min, max, spread and verdict in perf.md matches. The relayed figures are W3's:
  - first content: 1657 vs 1598.15, i.e. +59 ms
  - long tasks: 531 vs 403.5, i.e. +127.5 ms

  CLS, load commits (+0/+1), drag commits (39 = 39) and the jest Profiler pin (mount 1, drag 2) hold in every window. The
  harness counts the same way on both trees: the DevTools hook commit counter and PerformanceObserver are installed by an
  init script before React loads.
- **The package is not sound as it stands, for three reasons:**
  1. **The written reading understates the regression.** perf.md "Reading" says first content is "above the before median
     by about 60-110 ms" in W3, W5 and W6. The real per-window median deltas for first card content are:

     | window | delta |
     |---|---|
     | W2 | +94 ms |
     | W3 | +59 ms |
     | W4 | +137 ms |
     | W5 | +70 ms |
     | W6 | **+221 ms** (1843 vs 1622) |

     The direction is consistent: after > before in all six windows. The "+59 ms" relayed to the owner is the smallest of
     them, not a representative figure. Across the four interleaved paired windows (W2-W5) the median delta is about
     +82 ms. The long-task range "90-130 ms" is accurate for W3/W5/W6; W4 is -2 ms.
  2. **Two of the six windows are not durable.** W4 and W5 are two of the three windows cited as PASS for first content.
     Their raw data and the verdict script (`verdict.py`) exist only in the lane scratch dir, which is swept after merge.
     They cannot be audited after merge.
  3. **The metric does not measure what a reader would assume.** "Time to first card content" is DOM readiness: the first
     `.panel-grid-card` with no `.panel-body-skeleton` and a canvas/svg/cell/metric node. On the after tree that card is
     still at opacity 0 at that instant, inside its `motion-enter` rise (420 ms, ease-out, delay 0 for index 0, up to
     400 ms delay for later cards). So the measured delta is a lower bound on the perceived delay to visible content
     under Full. This matches D13's own definition, so it is not dishonest. But the owner should be told the measurement
     excludes the entrance itself.

### Phase 3: UI Review — PASS

Real browser on dev 7016 / backend 9923, desktop at 1440x900. The checks below were done in the MCP browser. The
executor's mid-frame screenshots in both themes are in evidence, and my own fresh e2e run covered both themes for every
mode.

- **Happy path, Full:**
  - A cold network load of a never-fetched dashboard staggers in reading order. Index 0-5 give delays 0-200 ms on 0.42 s
    `motion-enter`, carried on the card, not on the item.
  - A Home → dashboard round trip and an sm-crossing resize (1440 → 1100 swaps to the phone stack) replay nothing.
  - The detail modal gets `ui-modal--expanding`, `ui-modal-fade-in`, and one `expand-from` WAAPI animation; its backdrop
    runs `ui-modal-backdrop-in 0.16s`.
  - The palette runs `command-palette-in 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.1)`, with rows delayed 0-0.4 s (capped at 10).
    Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/e2e-evidence/HEL-1584/eval-c1-full-dark-palette-settled.png`.
  - The dashboard first shown after a page reload restored from the warm store and played no entrance. This is the D4 rule
    by design ("restore = instant").
- **Off:**
  - Grid cards: `motion-enter` at 1e-05 s.
  - Modal: `ui-modal-in` at 1e-05 s, backdrop at 1e-05 s, no WAAPI animation.
  - Palette: 1e-05 s, rows 1e-05 s with 0 s delay.
  - `document.getAnimations()` sampled over about 700 ms found no moving animation longer than 0.01 ms on grid, modal or
    palette.
- **OS reduce (`motion: null` with `prefers-reduced-motion: reduce`):** covered by my fresh run of
  `hel1584-motion-surfaces.spec.ts:312` "os-reduce / light" and "os-reduce / dark", both green. That test asserts no
  transform/translate/scale/position animation longer than 0.01 ms on grid, modal and palette, against a Full control that
  must animate.
- **Breakpoints:**

  | viewport | shell | zoom container (px) | live grid/stack root (px) |
  |---|---|---|---|
  | 1440 | grid | 1088 | 1088 |
  | 1100 | stack | 748 | 748 |
  | 768 | stack | 728 | 728 |
  | 375 | stack | 335 | 335 |

  Document overflow is 0 at every width.
- **Console:** 0 errors on load. Four ECharts "Can't get DOM width or height" warnings appeared only during the
  1440 → 1100 shell swap, not on load. They come from the stack mounting charts and are not attributable to this diff.
- Accessibility:
  - The saved check is `role="img"` with `aria-label="Saved"`.
  - The palette rows keep `role="option"` and `aria-selected`.
  - The pending route layer is `inert` with `aria-hidden`.
- Subjective feel against the Motion / MotionLive boards is deferred to the skeptic. One observation for them: mid-frame,
  the palette's group labels (GENERAL, CREATE) show while their staggered rows are still at opacity 0
  (`evidence/screenshots/full-dark-6-palette-mid-frame.png`).

### Overall: FAIL

### Change Requests

1. **perf.md "Reading" understates the first-content regression.** Fix
   `/home/matt/Development/helio/.concertino/runs/HEL-1584/evidence/perf.md` ("Reading", second bullet) and the PR/owner
   summary:
   - Replace "about 60-110 ms (3-7%)" with the per-window median deltas for first card content: W2 +94, W3 +59, W4 +137,
     W5 +70, W6 +221 ms.
   - State that the direction is consistent across all six windows, and that the interleaved paired windows (W2-W5) have a
     median of about +82 ms.
   - Re-send the corrected figures to the orchestrator for the pending owner ruling. "+59 ms" alone is the most favourable
     window, not a representative one.
2. **W4/W5 raw data is not durable.** Persist the raw data behind W4/W5 and the ablations, plus the verdict script, with
   `scripts/concertino/persist-evidence.sh HEL-1584 <path>`, and cite the returned `ref=` paths in perf.md:
   - `scratch/HEL-1584/x-base.jsonl`, `x-head.jsonl`, `x-nocf.jsonl`, `x-noent.jsonl`
   - `y-base.jsonl`, `y-head.jsonl`, `y-pause.jsonl`
   - `verdict.py`

   Two of the three windows cited as PASS currently exist only in the lane scratch dir, which is swept after merge.
3. **perf.md does not say what "time to first card content" excludes.** Add a sentence to its "Method" paragraph: the
   metric is DOM readiness (the content node present), so on the after tree it excludes the entrance itself. Cards are
   still at opacity 0 at that instant and rise over `--motion-duration-emphasized` (420 ms) with up to 400 ms of stagger.
   So the measured delta is a lower bound on the perceived delay to visible content under Full.
4. **`CommandPalette.tsx:44-48` detaches `groupBySection`'s doc comment.** `rowEntrance` and its one-line doc comment were
   inserted between `groupBySection`'s long JSDoc (ending `deliberate position. */` at :43) and `function groupBySection`
   (:50). That JSDoc now attaches to `rowEntrance`. Move `rowEntrance` and its comment below `groupBySection` (or above the
   JSDoc block), so the comment ending at :43 sits directly above `function groupBySection`.

### Non-blocking Suggestions

- S1. Three edited files are over CONTRIBUTING.md's ~400-line threshold: `PanelList.tsx` (526), `panelsSlice.ts` (527)
  and `dashboardsSlice.ts` (538). That rule asks for a split proposal in the PR description.
- S2. The D8 risk check ("detail-modal geometry specs measure during the WAAPI expand") is unproven. hel716 is
  quarantined and fails at its setup POST, before any modal geometry is measured. `fill: "none"` makes a lingering
  transform impossible, but say so in the PR rather than listing hel716 as green-relevant.
- S3. Rename `evidence/quarantined-specs-on-base.txt` (it is a HEAD run, per its config and timestamp), or add a header
  naming the tree it ran on and the HEL-951 quarantine reasons it matches.
- S4. `origin/main` gained HEL-1583 and HEL-1628 after the base. Merge-tree is textually clean. Re-run the motion token
  guard's CSS file count and the HEL-1583 mobile specs after the rebase (design.md Risks already calls this out).
