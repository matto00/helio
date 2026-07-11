## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **The specific fix from round 1 (numeric coercion for `sum`/`avg`/`min`/`max`) is sound.**
   - Ran the guard `s.trim() !== "" && Number.isFinite(Number(s))` against `""`, `" "`, `"0"`, `"5.5"`,
     `"-3"`, `"abc"`, `"5abc"`, `"5 5"` in Node — behaves exactly as design.md Decision 2 claims
     (rejects blank/whitespace/non-numeric, accepts valid numeric strings).
   - Confirmed `AggregateStep.scala:87` (`groupRows.flatMap(r => PipelineRowJson.toDouble(...))`) and
     `PipelineRowJson.scala:59` (`case s: String => s.toDoubleOption`) — Scala's `"".toDoubleOption` is
     `None`, matching the new guard's rejection of `""`. `sum`/`avg`/`min`/`max` empty-list behavior
     (`AggregateStep.scala:89-92`) matches Decision 2's stated `sum=0`/`avg,min,max=null` semantics.
   - Confirmed `usePanelData.ts:88-92` builds `rawRows` via
     `Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : ""))` — matches
     design's characterization of the `""` null sentinel exactly.
   - Confirmed the existing per-row chart path (`ChartPanel.tsx:36,49,65,85,100`) already uses
     `parseFloat` + `isNaN` guards, so Decision 4's claim that the pre-existing path already dodges
     this bug (and the new grouped path must get equivalent protection) is accurate.
   - **Conclusion: the round-1 numeric-coercion flaw is genuinely fixed for `sum`/`avg`/`min`/`max`.**

2. **A structurally identical, unaddressed flaw remains for `count` on the chart's groupBy path.**
   This is a new finding from a fresh full pass, not a re-litigation of round 1.
   - Decision 2 defines `count` as "number of rows where `field` is non-null/non-undefined" — a
     literal null-check, not the `""`-guard used for the numeric functions. `AggregateStep.scala:93`
     confirms this is the correct Scala-side semantics (`r.getOrElse(field, null) != null`).
   - Decision 4 states `groupAndAggregate` operates on **`rawRows`** (`ChartPanel`'s already-stringified
     `string[][]`, confirmed at `ChartPanel.tsx:15-21` — `buildDataOption(rawRows, headers, ...)` — and
     `usePanelData.ts` only exposes `rawRows`/`headers` to `ChartPanel`, never the raw typed `rows`
     object array; tasks 5.3/5.4 don't add a raw-rows prop either).
   - By the time a row reaches `groupAndAggregate`, a genuinely-null `yField` cell and a genuinely
     **empty-string** `yField` cell are **indistinguishable** — both are `""`. This is fine for
     `sum`/`avg`/`min`/`max` (a blank string was never going to be "coercible to a finite number"
     regardless of whether it started as `null` or `""`, so excluding it is correct either way — no
     information is lost that the numeric functions needed). It is **not** fine for `count`: `count`'s
     job is specifically to distinguish "present" from "null", and once the value is `""` there is no
     way to tell "this yField cell was really null" apart from "this yField cell's real value is an
     empty string" — the distinction `AggregateStep`'s `!= null` check depends on has already been
     destroyed upstream by `usePanelData`'s stringification.
   - Concretely: if a chart is configured with `{ groupBy: "genre", agg: "count", yField: "title" }`
     and some rows have a genuinely-null `title`, a straightforward implementation of Decision 2's
     `count` rule (`!= null && != undefined`) applied to the already-stringified rows will find every
     cell to be a non-null string (even the `""` ones) and **overcount** — silently including the
     null-sentinel rows in the count. This is the *same defect class* the round-1 REFUTE caught
     (null-sentinel silently treated as present data), now in `count` instead of the numeric functions,
     and round 2's fix does not close it: Decision 2's guard is explicitly scoped to "numeric coercion"
     and Decision 4's "MUST reuse this coercion guard" instruction only talks about the
     `Number(s)`-vs-`0` failure mode, not `count`'s null-check.
   - This also directly contradicts the design's own spec scenario
     (`specs/panel-viz-aggregation/spec.md:34-36`, "Chart aggregation is null-tolerant" — "those rows
     are excluded from that group's aggregate computation") when `agg = "count"` is the function under
     test, and the "Aggregation semantics match the pipeline aggregate step" requirement
     (`specs/panel-viz-aggregation/spec.md:47-48`, "`count` counts rows where the target field is
     non-null") — which is unachievable as stated for the chart path given the current data flow,
     unless the design is revised.
   - Tasks 7.1/7.3 (the round-2-added explicit-`""`-test requirement) only require proving `""` is
     "excluded rather than coerced to `0`" — phrasing that pins the test to the numeric functions, not
     to `count`. Nothing in tasks.md requires a test proving `count` correctly excludes a null-sentinel
     row in the chart's grouped path.

3. **Fresh pass over the rest of proposal.md/design.md/tasks.md/specs/ — no other blocking issues found.**
   - `MetricPanelConfig`/`ChartPanelConfig` (`backend/.../MetricPanel.scala`, `ChartPanel.scala`) are
     confirmed `jsonFormat2` today (`dataTypeId`, `fieldMapping`) — Decision 5's "bump to `jsonFormat3`"
     claim is accurate and the tolerant-decode/absent-vs-null `Patch` pattern described is exactly what
     exists to extend.
   - `ProposalPanel`'s custom reader/writer (`DashboardProposalProtocol.scala:33-55`) is confirmed
     tolerant of absent optional fields exactly as Decision 5 describes; adding `aggregation` the same
     way as `fieldMapping` is straightforward.
   - `schemas/panel.schema.json`'s per-type config objects use `"additionalProperties": false`,
     confirming task 2.1's schema-update requirement is real (not already covered).
   - Metric path (`usePanelData.ts`, task 5.2) computes aggregation over the raw Redux `rows` (not the
     stringified `rawRows`), so real `null`/`undefined` survive intact there — the count/null-sentinel
     problem above is specific to the chart path and does not affect the metric path.
   - `fetchDataTypeRows`/`fetchPanelPage` (`panelThunks.ts:248-252`) confirmed to already fetch the
     full row set and slice client-side — Decision 1's "no new backend query path" claim holds; the
     `GET /api/types/:id/rows` route (`DataTypeRoutes.scala:41-44`) returns the full unpaginated set.
   - `panel.ts` types file confirmed to have the expected `MetricPanelConfig`/`ChartPanelConfig`
     interfaces to extend; no conflicting shape already in place.
   - Capability/spec deltas (`specs/panel-viz-aggregation`, `specs/echarts-chart-panel`,
     `specs/panel-datatype-binding`) are internally consistent with proposal.md's "Modified/New
     Capabilities" list and with tasks.md; no orphaned AC or scope drift found beyond the count/null
     issue above.

### Verdict: REFUTE

### Change Requests

1. **Close the `count`-vs-null-sentinel gap on the chart groupBy path** (design.md Decisions 2 & 4;
   `specs/panel-viz-aggregation/spec.md` "Aggregation semantics match the pipeline aggregate step" and
   "Chart aggregation is null-tolerant"; tasks 4.2/4.3/7.1/7.3). Because `groupAndAggregate` only ever
   sees `ChartPanel`'s already-stringified `rawRows` (real `null`/`undefined` and a real empty string
   are both `""` by the time they arrive), `count`'s "non-null" check as currently specified cannot
   correctly match `AggregateStep`'s null-tolerant `count` semantics for the chart path — this is a
   structural data-flow gap, not something a coercion guard on the numeric path can fix. Pick one and
   update the design accordingly:
   - (a) Thread the real (non-stringified) row values into the chart aggregation path specifically
     (e.g. a new prop/param carrying the raw bound rows, bypassing `rawRows` for the `groupAndAggregate`
     call only), so `count` can distinguish null from empty string; or
   - (b) Explicitly narrow the chart-side `AggFn` enum to exclude `count` (only `sum|avg|min|max`,
     which the existing `""`-guard fully and correctly handles) until (a) is done, and update
     `specs/panel-viz-aggregation/spec.md`'s chart `AggFn` union and the ticket's scope accordingly; or
   - (c) Explicitly document a deliberate compromise (chart-side `count` treats a real empty string the
     same as null, "counts non-blank cells" rather than "counts non-null cells") and adjust the "matches
     `AggregateStep` semantics exactly" claim to note this one documented divergence.
   Whichever is chosen, add an explicit task (alongside 7.1/7.3) requiring a test that proves a
   genuinely-null `yField` cell (appearing as `""` in `rawRows`) is excluded from a **`count`**
   aggregation specifically in the chart's grouped path — not just from `sum`/`avg`, which round 2
   already covers.

### Non-blocking notes

- Decision 2's claim that the JS guard "mirrors Scala's `s.toDoubleOption` ... exactly" is slightly
  overstated at the margins: Java/Scala's `Double.parseDouble` accepts the literal strings `"Infinity"`
  and `"NaN"` as valid doubles (`"Infinity".toDoubleOption` → `Some(Infinity)`), while
  `Number.isFinite(Number("Infinity"))` is `false` under the new guard (rejected). Conversely,
  `Number("0x10")` is `16` in JS (accepted by the guard) while Scala's `"0x10".toDoubleOption` is `None`
  (rejected — no `p`-exponent, so not a valid Java hex-float literal). These are extreme-edge-case
  divergences (unlikely to occur in real rating/count/price columns) and don't block the design, but the
  "matches ... exactly" wording could be softened to "matches for all realistic numeric-string inputs;
  a few pathological string literals (`"Infinity"`, `"NaN"`, hex notation) diverge and are considered
  acceptable" so a future reader isn't misled into assuming byte-for-byte parity.
- A `groupBy` field that is itself null collapses to the `""` category bucket in the chart's grouped
  rendering (same as a real empty-string group value would). This is arguably consistent with
  `AggregateStep.apply`'s behavior (a null groupBy key also forms its own group there), so it's not a
  regression, but the design doesn't say anything about labeling/rendering that bucket (blank category
  label) — worth a one-line callout in Decision 4 for the implementer, not blocking.
