## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three spec deltas
  (`specs/panel-viz-aggregation/spec.md`, `specs/panel-datatype-binding/spec.md`,
  `specs/echarts-chart-panel/spec.md`) in full.
- **Decision 1 (client-side, full-fetch aggregation) — confirmed accurate.**
  `frontend/src/features/panels/state/panelThunks.ts:237-256` (`fetchPanelPage`) calls
  `fetchDataTypeRows(dataTypeId)` (full row set, one call) then does
  `rows.slice(start, start + pageSize)` client-side. `panelsSlice.ts:179-189`
  (`fetchPanelPage.fulfilled`) replaces `rows` on `page === 0`, so a `pageSize` of
  `Number.MAX_SAFE_INTEGER` on page 0 yields the entire row set in `paginationState`.
  `usePanelData.ts:59` confirms the current metric/chart/table page sizes are `10/200/50`
  exactly as design.md states. This load-bearing claim for Decision 1 holds.
- **Bound-trio config shapes and tolerant-decode/Patch pattern — confirmed accurate.**
  `backend/.../domain/panels/MetricPanel.scala` and `ChartPanel.scala` both match
  design.md's description exactly: `jsonFormat2`, tolerant `decode`/`decodeCreate`,
  `Patch(dataTypeId: Option[Option[...]], fieldMapping: Option[Option[JsObject]])` with
  the absent/`Some(None)`/`Some(Some(v))` shape, `applyPatch` via `.fold`. Frontend
  `panel.ts:65-72` matches. `PanelConfigCodec.scala` truly delegates to per-subtype
  `decode`/`Patch.decode` with no aggregation-aware logic of its own — task 1.3's
  "no code change expected" claim holds.
- **`AggregateStep.scala` semantics — confirmed accurate.** `sum` = `nums.sum` (0 on
  empty), `avg`/`min`/`max` = `null` on empty `nums`, `count` = non-null count
  (independent of numeric coercion), numeric coercion via `PipelineRowJson.toDouble`
  which for `String` uses `s.toDoubleOption` (strict, empty string → `None`). Matches
  design.md Decision 2's description.
- **MCP/proposal wiring — confirmed accurate.** `helio-mcp/src/tools/proposal.ts:32-38`
  (`panelSchema`) and `helio-mcp/src/types.ts:193-199` (`ProposalPanel`) currently have no
  `aggregation` field, confirming tasks 3.1/3.2 target real gaps.
  `backend/.../DashboardProposalProtocol.scala:15-52` (`ProposalPanel` + custom
  reader/writer) matches design's "already tolerates absent optional fields" claim.
  `schemas/dashboard-proposal.schema.json` and `schemas/panel.schema.json` both have
  `additionalProperties: false` on the relevant objects, confirming the schema edits in
  tasks 2.1/2.2 are actually required (not redundant).
- **Scope sizing:** tasks.md's 7 sections map 1:1 onto design.md's 5 decisions +
  proposal's "Impact" list, with no scope creep beyond the ticket (no metric
  label/unit fixes, no chart appearance depth, no backend aggregation path — all
  correctly fenced off as non-goals and verified absent from tasks.md).

### Concrete design flaw found (verified against running code, not asserted)

`ChartPanel.tsx`'s existing `buildDataOption(rawRows: string[][], headers, fieldMapping, chartType)`
receives **stringified** rows: `usePanelData.ts:84-91` builds `rawRows` via
`Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : ""))` — i.e.
every `null`/`undefined` cell becomes the literal empty string `""` before it ever reaches
`ChartPanel`. `PanelContent.tsx:78-86` → `ChartRenderer.tsx` confirms this stringified
`rawRows`/`headers` pair is the *only* row data `ChartPanel` ever receives — there is no
typed-row prop available to it.

design.md Decision 4 explicitly commits the chart aggregation path to operate on this
same `rawRows`/`headers` pair ("`ChartPanel`'s `buildDataOption` groups `rawRows` by the
`groupBy` column"). Decision 2 specifies `computeAggregate`'s numeric coercion as
"a string where `Number(s)` is finite."

I verified in Node: `Number("") === 0` and `Number(" ") === 0` (both "finite"), whereas
the codebase's *existing* per-row numeric coercion in this exact file already avoids this
trap by using `parseFloat(...)` instead, which correctly yields `NaN` for `""`
(`parseFloat("") === NaN`, verified).

**Consequence:** if `groupAndAggregate`/`computeAggregate` is implemented per Decision 2's
literal `Number(s)` spec and fed the `rawRows` per Decision 4, every row whose `yField`
(or metric `value` field, if ever routed through the stringified path) was originally
`null`/`undefined` will silently coerce to `0` and be **included** in the aggregate as a
valid data point — the opposite of "null-tolerant." This directly contradicts two
acceptance scenarios the design itself authored:
- `specs/panel-viz-aggregation/spec.md` — "Chart aggregation is null-tolerant... those
  rows are excluded from that group's aggregate computation" (lines 34-36).
- `specs/echarts-chart-panel/spec.md` — the MODIFIED chart requirement inherits the same
  null-tolerance expectation for the grouped/aggregated render path.

This is not a hypothetical edge case — it is the exact scenario spec.md calls out as a
first-class acceptance criterion, and the bug is a well-known JS `Number()` gotcha the
design's own codebase has already had to route around once (via `parseFloat`) in the same
function this change extends.

Note: the metric-panel aggregation path (Decision 3, task 5.2) computes over
`usePanelData`'s internal `rows` (typed `Record<string, unknown>[]`, not stringified), so
it does **not** have this bug — only the chart/`groupBy` path, which is explicitly
anchored on `rawRows` by Decision 4, is affected.

### Verdict: REFUTE

### Change Requests

1. **Fix the null-coercion gap in the chart aggregation spec (design.md Decision 2 +
   Decision 4; tasks 4.2/4.3).** Revise `computeAggregate`/`groupAndAggregate`'s numeric
   coercion so it does not treat `usePanelData`'s null-sentinel `""` as a valid `0`. Either
   (a) explicitly guard against empty/whitespace-only strings before calling `Number()`
   (e.g. `s.trim() !== "" && Number.isFinite(Number(s))`), which also more faithfully
   mirrors Scala's strict `s.toDoubleOption` (which rejects `""` too — closer parity than
   raw `Number()`), or (b) route the chart aggregation path through typed rows instead of
   the stringified `rawRows`/`headers` pair (would require exposing `usePanelData`'s
   internal typed `rows` to `ChartPanel`, a larger change). Option (a) is the minimal fix
   consistent with the design's existing "reuse `rawRows`" approach.
2. **Add an explicit test case** (task 7.1 and/or 7.3) asserting that a row whose
   `yField`/aggregation field was originally `null`/`undefined` — and therefore appears as
   the literal string `""` in `rawRows` — is excluded from the chart-level aggregate, not
   merely that typed `null`/`undefined` values are excluded. As written, task 7.1's "null
   or non-numeric field" fixture is ambiguous as to whether it exercises the
   already-stringified `""` case that actually reaches `ChartPanel`.

### Non-blocking notes

- `MetricPanelConfig`/`ChartPanelConfig` currently use `jsonFormat2`; adding the third
  `aggregation` field mechanically requires bumping to `jsonFormat3` — implicit in tasks
  1.1/1.2 but worth calling out explicitly so the executor doesn't miss the format-arity
  change alongside the `decode`/`Patch` updates.
- Decision 2 doesn't explicitly restate the `sum`-on-zero-coercible-values behavior (should
  be `0`, matching `AggregateStep`'s `nums.sum` on an empty list, not `null`) — only
  avg/min/max's null-on-empty is called out. Minor clarity gap, not a correctness bug since
  it's the natural reading by omission, but worth stating explicitly in the design and
  covering in task 7.1's test list.
