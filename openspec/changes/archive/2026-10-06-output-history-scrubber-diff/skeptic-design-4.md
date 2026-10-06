## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: proposal.md, design.md (D1–D13), tasks.md, and the four spec deltas, against the live tree at HEAD 3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526. `git status --short` shows only the change directory untracked. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/pipeline-run-scrubber-overlay/HEL-1277`. I did not re-open the owner rulings Q1–Q4 (C1–C4), the epic rulings D1–D10, or the driver constraints.

### What I verified (with evidence)

**Round-3 CR1 (History-view overlay compatibility) is resolved.**
- **Design D5** now gates the History chart overlay with a pure `selectPointOverlay(selected, comparison)` helper, which sits beside `selectChartOverlay`. It draws an overlay only when all of these hold:
  - the comparison series is non-null;
  - `mode`/`x`/`y`/`agg` are identical on both sides;
  - in `rows` mode, neither side repeats an x.
- **Downsampled series** are explicitly allowed, and the reason is stated: both sides share the reducer's 200-point cap. D9 rejects them on dashboards because a dashboard's primary is raw rows.
- **Spec.** `output-history-scrubber/spec.md`, "Chart Outputs show the point's series…", now states the same rule. The word "compatible" no longer appears anywhere; I grepped every artifact for it.
- **Spec scenario.** "Incompatible comparison series" (different `y` or `agg` gives no overlay and no "vs" legend entry) is at spec.md:81.
- **Tasks.** Task 2.5 covers the helper's unit tests (mismatch, repeated x, downsampled allowed, null series). Task 4.5 adds the component case.
- **Checked against the backend.** `OutputSummaryReducer.scala` `seriesJson` emits `mode`, `x`, `y`, `agg` (null in rows mode), `points`, `totalPoints` and `downsampled`. Grouped mode uses `x = groupBy` and `y = yField`. Downsampling picks a subset of indices, so it never creates duplicate x values. Every field the identity rule compares therefore exists in the stored series, and the rule is mechanically checkable.

**Round-3 CR2 (RunHistoryModal spec/design contradiction) is resolved.**
- `output-history-scrubber/spec.md` (first requirement) now reads "unchanged except that its trigger labels come from the same shared trigger-source label helper, so an `auto-run` run reads 'Auto-run'". That matches the Non-Goals, D4 and task 2.4.
- The underlying fact still holds: `RunHistoryModal.tsx:54-56` maps only manual, scheduled and external.

**The round-3 non-blocking notes are folded in.**
- Section 5 of the tasks now runs in order (5.1 to 5.4).
- Task 3.2 includes "public `total` 0 before first load never yields an overlay".

**Earlier resolutions (rounds 1–3) still hold.**
- HEAD is unchanged from the commit those rounds verified, so their code facts stand.
- The artifact text for each is still present:
  - D9 public `rowsTruncated` with fail-closed on `undefined`, plus the "Truncated public chart" scenario.
  - D9 rows-mode identity rule, plus the aggregated-Output scenario.
  - D8 exclusions for normalized and horizontal bars, plus their scenario.
  - D10 schemas: `seriesSummary` already exists in both schema files.
  - D11 and the MCP delta.
  - D12 reachability non-goal.
  - D13 tier helper.
  - D7 `leadingColumns`.
- A grep for TODO, TBD and "figure out" finds nothing.
- "previous run" appears only in prohibitions and in the existing MCP description requirement.

**Whole-design judgment.** All three ACs are covered:
- **AC1** (scrubbing shows each point's summary, and rows when a payload exists): D4–D6, tasks 4.2–4.5.
- **AC2** (overlay series is labelled): D8 and D9, tasks 3.1 and 3.2.
- **AC3** (light/dark visual checks): tasks 4.6 and 5.3.

Every driver constraint maps to a task:
- payload-missing degradation: D6/D7, scenario "Missing comparison payload never reads as removal";
- no `historyPayloads` toggle: PATCH-seeded in 5.1;
- no "previous run" copy;
- D8 public summary-only;
- `isolateLivePage`;
- no edits to `playwright.config.ts`, `ci.yml` or `.gitignore`;
- no migration.

The contract change (`series` on resolved points) has its schema and route-spec deltas planned in the same change. I found no remaining internal contradiction or ambiguity that would block implementation.

### Verdict: CONFIRM

### Non-blocking notes
- In tasks.md section 2, 2.5 is listed before 2.4. This is cosmetic only, with no ordering dependency.
- Final-gate visual items carried forward from earlier rounds:
  - The side-by-side bar overlay halves bar widths, and `z` has no effect on side-by-side bars.
  - Judge the dashed and muted overlay contrast in both themes on the running app, for the History modal and for dashboard panels.
- When downsampled series are allowed in the History view, the two sides may sample different x subsets, so some overlay values will be null gaps. That follows from D8's alignment and is acceptable, but expect visible gaps on long series at the final gate.
