## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read fresh (not assuming round 1's read still holds): `ticket.md`,
  `proposal.md`, `design.md`, `tasks.md`,
  `specs/chart-drilldown-inspect/spec.md`, `specs/panel-body-click/spec.md`,
  and round 1's own report (`skeptic-design-1.md`) as a claim to verify, not
  a fact.
- Re-derived `SelectionDescriptor` field semantics against the live
  `frontend/src/features/panels/ui/ChartPanel.tsx` `buildDataOption`
  (lines 56-209), branch by branch, rather than trusting design.md's prose:
  - **Single-series bar/line** (178-190): `xAxis.data` = categories from
    `r[xCol]`, one series named `headers[yCol]`. An ECharts series click's
    `params.name` is the axis category (the clicked bar's x value) and
    `params.seriesName` is `headers[yCol]`. Matches design.md D3 exactly:
    `dimension = fieldMapping.xAxis`/`headers[xCol]`, `value = params.name`,
    `series = fieldMapping.yAxis`/`headers[yCol]`.
  - **Multi-series bar/line** (153-176): `xAxis.data = allX` (shared
    categories), one series per `seriesCol` group named `g`. Click
    `params.name` = the shared category, `params.seriesName` = the group
    value. Matches D3: `dimension = headers[xCol]`, `value = params.name`,
    `series = params.seriesName`.
  - **Pie** (126-151): pie's one series has `data = [{name: r[xCol], value:
    ...}]`. Click `params.name` = `r[xCol]` (the slice label). Matches D3:
    `value = params.name` (the slice's name) — this is the exact case round
    1 flagged as having "no defined role for `value`"; it is now defined and
    matches the code's actual `params.name` semantics for a pie click.
  - **Scatter** (78-116): points are `[parseFloat(r[xCol]), parseFloat(r[yCol]),
    ...]`; click `params.value[0]` is the numeric x. Matches D3:
    `value = String(params.value[0])`, and D4's row filter
    `parseFloat(row[xCol]) === parseFloat(value)` is the correct inverse of
    that stringification (avoids the `"3"` vs `"3.0"` string-equality trap
    the design itself calls out).
  - Confirmed no stale reference to the old (round 1-flagged) reading
    survives anywhere in the artifacts: `grep -rn "dimension = params.name"
    design.md tasks.md specs/` returns nothing; the only "row identity"
    mentions left are the explicit "an earlier draft ... dropped in favor
    of" callout, not live spec text.
- Checked `tasks.md` 2.2 (bar/line), 2.3 (pie), 2.4 (scatter), 2.5
  (row-filter helper), and 4.1 (inspect header text) all restate the same
  `dimension`/`value`/`series` semantics as D3/D4/D5, word-for-word
  consistent — no divergence between design.md and tasks.md.
- Checked `specs/chart-drilldown-inspect/spec.md`'s four new-value scenarios
  ("single-series bar", "multi-series line", "pie slice", "scatter point")
  against the same code trace above — each scenario's asserted `value`
  content (bar/line: x-axis category; pie: slice name; scatter: point's x
  value) matches what `params.name`/`params.value[0]` actually carry for
  that branch. This closes CR1: `value` now has defined, code-consistent
  semantics in ticket.md/design.md/tasks.md/spec.md alike.
- Checked the revised clearing requirement in
  `specs/chart-drilldown-inspect/spec.md` ("The selection descriptor is view
  state, cleared on panel/dashboard switch," lines 49-57) against design.md
  D1's two implemented clear points (`deletePanel.fulfilled`,
  `fetchPanels.pending`) and D1's cross-panel-read rationale: spec.md now
  states plainly "cleared when the owning panel is removed, or when the user
  navigates to a different dashboard... NOT cleared merely because a
  different panel's inspect view is opened or closed" — this matches D1's
  two clear points exactly (no third, unimplemented "switches to a different
  panel's inspect view" trigger), and no longer contradicts D1's own stated
  reason for using Redux (HEL-588 needs to read a panel's selection from
  outside that panel's subtree regardless of what other panels' inspect
  views are doing). The two spec scenarios ("Switching dashboards clears the
  selection", "Reloading the page clears the selection") match exactly what
  tasks 1.3/4.4 implement. This closes CR2.
- Confirmed `ticket.md`'s own AC text ("cleared on panel/dashboard switch")
  is what spec.md now reflects — no invented clause beyond the ticket's own
  scope.
- Checked Planner Notes' corrected claim about `paginationState` (no longer
  asserts a "well-tested" existing mirrored clearing mechanism) still holds
  against the same `panelsSlice.ts` re-check as round 1 — unchanged, still
  accurate.
- Looked for any NEW inconsistency the revision itself might have
  introduced: D3/D4/D5/tasks.md/spec.md all now agree on
  `dimension`=source column name, `value`=clicked category/label,
  `series`=measure/group identifier, with D4's filter predicate correctly
  using `value`/`series` (not `dimension`) against the resolved
  `xCol`/`seriesCol` indices. No contradiction found. (One very minor,
  non-blocking imprecision: D3's pie bullet says `series` is "resolved via
  the SAME mapped-or-auto-detected logic ... (shared helper, D4)," but D4's
  shared-helper text is framed around `xCol`/`seriesCol` resolution, not the
  pie-specific first-numeric-column auto-detect scan (lines 138-148 of
  `ChartPanel.tsx`). This is moot in practice — round 1 independently
  verified `fieldMapping.yAxis` is always populated for any persisted chart
  Output (`OutputBindingSpec.requiredSlots`/`OutputService.validateFieldMapping`),
  so that auto-detect branch is unreachable — but is worth a one-line
  tightening if the executor touches that area. Not blocking.)

### Verdict: CONFIRM

### Non-blocking notes

- The D3 pie-branch cross-reference to "shared helper, D4" for `yCol`
  auto-detection is imprecise (D4's shared helper covers `xCol`/`seriesCol`
  index resolution, not the pie-specific numeric-column scan) — harmless
  since that scan path is unreachable for real chart Outputs, but could be
  tightened in a follow-up edit for clarity.
