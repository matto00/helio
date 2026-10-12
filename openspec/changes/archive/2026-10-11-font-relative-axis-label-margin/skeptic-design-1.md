## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: the untracked change dir on branch `feature/show-every-axis-label/HEL-1512`, HEAD `2e02b79511fab222ac2bc73a142fc61e0979f192` (= main). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/show-every-axis-label/HEL-1512`.

### What I verified (with evidence)

- **Main has no category show-all.** `frontend/src/features/panels/ui/buildChartOption.ts:209-221`: x `axisLabel` gets only `color`, plus `hideOverlap` when `timeInstants` is set. y gets only `color`. The compact path (`:363-385`) spreads the built `axisLabel` and overrides only `fontSize: COMPACT_AXIS_LABEL_FONT_SIZE` (10, `:47`). The proposal and design context are correct.
- **The prior implementation exists as described.** `git diff HEAD 8fb843d1b` on the two files shows `CATEGORY_LABEL_SHOW_ALL {interval:0, hideOverlap:true}`, `categoryLabelLineHeight = ceil(fs*1.2)`, `categoryLabelShowAll`, `CATEGORY_X_LABEL_TEXT_MARGIN [0,8]`, `categoryXLabelShowAll`, `showsEveryCategoryLabel` and `fontSizeOf`. Its compact path adds only `lineHeight`, so it inherits the normal-mode `textMargin`, which was evaluation-4's CR1 defect. Decision 2 targets exactly that.
- **The "hide threshold is about 2 x margin" mechanism is real (ECharts 6.1.0, lockfile line 6201).**
  - `echarts/lib/label/labelStyle.js:298-301`: `textMargin` is normalised via `normalizeCssArray`, so `[0,m]` becomes `[0,m,0,m]`.
  - `labelLayoutHelper.js:110` expands each label rect by that margin before the overlap test.
  - Two horizontal neighbours therefore collide when their gap is below 2m.
  - The ECharts default is `textMargin: [0,3]` (`coord/axisDefault.js:119`).
  - So a factor of 0.6 gives a hide threshold of 14.4 px at 12 px and 12.0 px at 10 px, as Decision 1 states.
- **Decision 4 holds.** Time axes are untouched because `wantsTimeAxis` (`chartTimeDataOptions.ts:21-30`) returns true only for line, scatter and vertical bar, so a heatmap or histogram never gets `timeInstants`. The `timestamp x: heatmap/histogram` snapshot cases (`unchangedPathCases.ts:131,136`) will change. They are heatmap/histogram entries, so task 3.2's scope covers them.
- **375 is always compact.** `MobilePanelStack.tsx:184` passes `compact`, so the 12 px floor at 375 maps to the 10 px font.
- **1440 is not always 12 px.** `ChartPanel.tsx:84-85` sets `effectiveCompact = compact || measuredHeight <= CHART_COMPACT_HEIGHT_PX (179)`. A short panel at 1440 renders 10 px labels with a 12 px threshold. See CR2.
- **The measurements behind 0.6 match evaluation-4's table** (`openspec/changes/archive/2026-10-11-chart-axis-label-polish/evaluation-4.md`, Phase 3):
  - heat x 7/7 at 375 with margins 3 to 6.
  - heat6 x at 375: 7/7 at m6, 4/7 at m7, real gap 12.0.
  - hist10 at 1440: 10/10 at m7, 9/10 at m8, last gap 14.85.
  - hist20 (w:6) at 1440: 13.95 at m7.
- **The design space is genuinely tight.** heat6 needs a margin of at most about 6 at 10 px, and hist10 needs at most about 7.42 at 12 px (14.85/2). Both bounds sit right at 0.6. The AC numbers are attainable, but with near-zero headroom at 375. That is why CR1 matters.
- **The handoff spec** (`.concertino/runs/HEL-1487/evidence/hel1512-handoff/hel1487-category-axis-labels.spec.ts`):
  - It reads `heatX` from the 3-row heatmap only. `heat8` (the 6-service, h:3 card that evaluation-4 calls "heat6") has only its y axis read.
  - It asserts no `heatX` count at 375.
  - It uses `hist10 >= 8`.
  - It applies a flat gap floor of 14 everywhere.
  - Decision 5 correctly tightens all four of these. See CR3 on the heat8 x read.
- **Red on main is achievable.** Main thins hist10 at 1440 (the proposal's 37-56 px observation, consistent with HEL-1487's RED transcript), so `hist10 length 10` fails on 2e02b7951.
- **Spec delta.** `openspec validate font-relative-axis-label-margin --strict` printed "Change ... is valid". The main spec (`openspec/specs/heatmap-histogram-charts/spec.md`) has no existing axis-label-visibility requirement, so ADDED (not MODIFIED) is correct.
- **AC coverage, item by item:**
  - 7/7 at 375 on both heatmaps: Decision 5.
  - 10/10 bins at 1440: Decision 5.
  - Gap ≥14 / ≥12: Decisions 1 and 5.
  - No regression to HEL-1305/1306: task 1.4 and C3.
  - Light and dark, 1440 and 375: the e2e matrix and C3.
  - hist20 decision: Decision 6 with an escalation path.
  - No AC is left without a task, and I found no scope drift.

### Verdict: REFUTE

The design is sound and close. Three revisions are needed. Each is cheap, and the first matters because HEL-1487 was failed for exactly this pattern: a relaxed e2e assertion that masked a real defect.

### Change Requests

1. **design.md Risks bullet 1 (the 0.5 px tolerance on the ≥12 floor): remove it, or bound it by a measurement.**
   - **The problem.** As written, the e2e passes a heatmap or histogram x gap of 11.5 px at 375. The ticket's AC says ≥12, so this relaxes the AC number by 0.5 px with no owner ruling. The stated justification ("measurement tolerance") is not measured.
   - **The only evidence of a measured discrepancy is about 0.05 px.** hist20 at m7 showed a real-text gap of 13.95 against ECharts' 14.0 threshold. A 0.5 px tolerance is 10 times that.
   - **Option (a):** assert `>= 12` (and `>= 14` at 1440) with at most a floating-point epsilon (≤ 0.05 px). heat6's measured gap is 12.0, so this passes, and the x5 run then shows whether the edge is stable.
   - **Option (b):** keep a tolerance, but only one sized from a recorded measurement of ECharts' label-rect width minus `measureText` width on the affected labels. Record that measurement in evidence, apply the tolerance only at the floor it was measured for, and never let it exceed the measured delta.
   - **If neither is stable:** that is the "factor cannot meet both floors and counts" case in C5. Escalate it rather than widen the tolerance.
   - **Also:** state explicitly that no tolerance applies to the 1440/14 px floor, which has 0.4 px of headroom by construction.
2. **specs/heatmap-histogram-charts/spec.md: the scenario "Labels never run together" contradicts the requirement text.**
   - **The contradiction.** The requirement ties the floor to the font: ≥14 at the 12 px font and ≥12 at the 10 px compact font. The scenario ties it to the viewport: ≥14 "at 1440 px" and ≥12 "at 375 px".
   - **Why it matters.** A measured-compact panel at 1440 (height ≤ 179 px, `ChartPanel.tsx:84-85`, `useChartCompact.ts:17`) renders 10 px labels with a 12 px threshold. The implementation would then violate the scenario as written, by design.
   - **The fix.** Phrase the scenario by font (default vs compact). Alternatively, state that 1440 means a non-compact card and 375 means the mobile stack.
   - **In design.md Decision 5,** state that every 1440 card the e2e gap-checks is non-compact. h:5 cards are; heat8 at h:3 may not be. Either exclude compact cards from the 14 px floor or assert 12 for them.
3. **design.md Decision 5 / tasks.md 3.3: spell out the heat8 x-axis read.**
   - The handoff spec never reads `heat8`'s x axis. It reads only `heat8Y`.
   - Task 3.3 must add a `heat8X: axisLabels(cards.heat8, "xAxis")` read.
   - It must also include `heat8X` in the overlap loop (automatic) and the x-gap loop (the handoff's loop is a hard-coded name list, `["heatX","hist5",...]`, so it is not automatic).
   - It must assert `heat8X.shown == DAYS` at both 375 and 1440.
   - heat8 at 375 is the threshold-edge chart (12.0 px), so it is the assertion that would catch a compact path inheriting the 7.2 margin (the 4/7 regression). If it is missing, the evaluation-4 CR1 defect has e2e coverage only through heat (3-row), whose 14.57 px gap would still pass at 7.2 × 2 = 14.4.

### Non-blocking notes

- Task 3.1 "red on main": a unit test that fails on main only because the new helpers do not exist (an import or type error) proves nothing about behaviour. The red evidence should include at least one assertion-level failure. For example, assert `buildChartOption(... heatmap ...).xAxis.axisLabel.interval === 0` against main's real export surface, or run a mutation (normal-mode margin leaking into compact) against the fixed code.
- Rewrite the source comment on the margin constant to state the real mechanism (the hide threshold is 2 × margin, so 0.6 em gives about 1.2 em). 8fb843d1b's comment for the value 8 was flagged as inaccurate by evaluation-4 CR1.
- The design uses "heat8" for evaluation-4's "heat6" (the same 6-service card, named `heat8`/"PanelRows8" in the handoff spec). Keep one name in the evidence to avoid confusion.
- C4: confirm that `currentUserId(request)` in `e2e/support/auth` actually hits `/api/auth/me`, as C4 requires.
