## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 0614c979a1007fcb0a4cae3b60b4128b3d8950a5 (main plus the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
`openspec validate fix-metric-headline-and-field --strict` → valid. That tool cannot catch either finding below.

### What I verified (with evidence)

**Round-2 CRs**
- **CR1 (D4): addressed with option (a).**
  - Server selection is unchanged.
  - The additive `metric` identity is on resolved `current`/`baseline`.
  - The client guard uses `baseline.metric`.
  - The `output-history-api` "Comparison resolution" MODIFIED block says `metric` "SHALL NOT change which point
    is selected".
  - This is within the planner's authority.
- **CR2 (MODIFIED blocks): addressed.** I extracted each requirement from `openspec/specs/` and diffed it against
  its delta. Results per block:
  - *`metric-history-delta-ui` / "Metric headline uses the server all-rows value…"*: the only change is the inserted
    filtered / client-cross-filter / no-field sentences before the original "Otherwise … exactly as before this
    change." sentence. All 4 original scenarios are byte-identical, and 3 scenarios are added.
  - *`metric-history-delta-ui` / "Metric delta shows direction…"*: one clause changed. "the baseline is not a
    returned point whose stored metric field/aggregation differs" became "the baseline's stored metric
    field/aggregation (its own `metric` identity …) equals". All 5 original scenarios are identical, and 1 is added.
  - *`output-history-api` / "Comparison resolution"*: the only change is the inserted `metric` sentence after
    "or `null` when the summary has none". All 7 original scenarios are identical, and 1 is added.
  - Nothing was dropped.
- **CR3 (D5 facts): the facts are now accurate. The decision is still not in authority** (see CR1 below).
  - `PanelContent.tsx:363-370` renders `LoadedScopeDisclosure` for every kind when `isCrossFiltered && rowsTruncated`.
  - Its wording is "{match} of {loaded} loaded rows match." (`LoadedScopeDisclosure.tsx`).
  - The impossible public clause was removed.
- **CR4 (measurement): addressed.**
  - Task 1.7 and D3 name EmbeddedPostgres and the `OutputHistoryCostMeasurementSpec` pattern.
  - That spec exists at `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryCostMeasurementSpec.scala`
    and is threshold-free.

**Code facts re-derived**
- `OutputSummaryReducer.metric` still has `if (mapping.size == 1) mapping.headOption`.
- `resolveServerMetricField` in `metricHistoryView.ts` has `strings.length === 1 ? strings[0]`.
- `MetricOutputPanel.tsx:65` feeds the loaded-rows aggregate from `resolveServerMetricField`, so the D1 client fix
  also fixes the loaded path. D1 is correct.
- `OutputRepository.findConfigById` (`:144`) and `findConfigsByIdsInternal` (`:156`) exist (D3).
- The history schemas exist: `schemas/outputs/output-history-response.schema.json` and
  `public-output-history-response.schema.json`. There is no public panel rows schema today, so D2 creates one.

**Specific question (1): is D5 honest, or does it sidestep a reserved product call? It sidesteps one.**
- The "can't compute over the full set" branch of the AC is genuinely reached. `useCrossFilterServerOps.ts` returns
  `client-fallback` in three cases:
  - the dimension is a timestamp column;
  - the column's capabilities are not `ready` or lack `eq`;
  - a control `eq` sits on the same column.
- `isPanelFilterableByDimension` (`utils/crossFilterRows.ts:114-126`) makes a metric panel a target whenever any
  `fieldMapping` value names the dimension, for example `label: region`. So a metric headline over truncated loaded
  rows is a live, shipped state that this change knowingly leaves in place.
- The ticket AC says, verbatim: "If you can't, label it clearly as computed over the loaded rows; **that wording is a
  product call, so escalate.**" The driver's brief says the same, and round 2 listed it under "Items for the owner
  escalation".
- Deciding that the *existing* wording is sufficient is still a wording decision. "No new copy" is one of the
  answers to the product question, not a way around it.
- The case for the existing wording is also contestable on its merits:
  - "12 of 200 loaded rows match." describes a row-match count. It does not say that the large number above it is
    computed over those rows.
  - HEL-588 designed it for the table/chart mental model (D7 comment: "one more row filter over the same loaded
    set").
  - The owner confirmed it (HEL-451 D10a) for filters on loaded rows, not as a label on an aggregate value.
- **This is a product call. The planner must escalate it, not decide it.**

**Specific question (2): do the MODIFIED blocks preserve the existing text? Yes** (see the CR2 diff above).
Adjacent requirements not modified:
- `metric-history-delta-ui` "Active viewer filter hides the comparison" (`spec.md:78-83`) says "SHALL show the
  headline computed from the filtered rows". That does not contradict the new full-filtered-set rule, but it reads
  ambiguously next to it. See N1.
- `public-dashboards` "Public row read…" and "Public panel rows accept sort and filter…" require the public route to
  be paginated and shaped "identically" to the authenticated route. Adding `metric` to both keeps that true.
- `output-snapshot-history` "Summary reducer matches the frontend aggregation" does not state the lone-mapping rule,
  so the ADDED requirement there contradicts nothing.
- `output-routes-api` "GET /api/outputs/:id/rows…" does not enumerate response keys exhaustively, so ADDED is
  acceptable there.

**New finding: the rows-response `metric` shape is undefined for a field-less metric.** Two parts of the plan
disagree:
- D2 and the `output-routes-api` ADDED requirement define `metric` as
  `{"field": string, "agg": string|null, "value": number|null}`.
- The same requirement's scenario "Metric with no valid field" says a label-only metric Output under a filter
  returns "`metric` is present with `value: null`".
- After D1, that config resolves to no field, so `field: string` has no value to hold.
- An implementer could emit `field: ""`, `field: null` (which breaks the stated schema), `metric: null`, or omit the
  key. Each choice changes the schema (`additionalProperties: false`, required/nullable), the D6 client match rule
  ("when its `field`/`agg` match `resolveServerMetricField(config)`", which is `null` here), and the 3.2 route
  assertion.
- The history summary stores `metric: null` for the same case. That precedent points to one consistent answer, but
  the artifacts must pick it explicitly.

### Verdict: REFUTE

### Change Requests

1. **D5: restore the owner escalation. Do not self-approve the loaded-rows labelling.** The ticket AC explicitly
   reserves this wording as a product call. Raise it before execution with a recommendation:
   - **Question:** a metric headline under a client-fallback cross-filter, with rows truncated, is computed over the
     loaded rows only. Is the existing HEL-588 "N of M loaded rows match." disclosure sufficient labelling?
   - **Options:**
     - (a) existing disclosure only (the planner's recommendation);
     - (b) metric-specific copy that replaces the disclosure on metric panels (e.g. "Computed over N of M loaded
       rows");
     - (c) metric-specific copy beside the disclosure.
   - **Context:** list the three `client-fallback` triggers and note that public dashboards cannot hit this.
   - Update D5, the Planner Notes ("No owner escalation") and the `metric-history-delta-ui` MODIFIED sentence
     ("the existing … disclosure labels it") so they are conditional on the ruling.
   - If (b) or (c) is chosen, task 2.4 needs the copy, an RTL assertion, and a DESIGN.md token/component check.
2. **Pin the field-less metric shape in the rows responses.** Choose one rule for the case where the Output kind is
   metric, a filter is applied, offset is 0, and no field resolves:
   - `"metric": null` (present, null), matching the stored summary;
   - omit the key;
   - make `field` nullable.
   Then make D2, the `output-routes-api` ADDED requirement text and its "Metric with no valid field" scenario, task
   1.5's schema shape, the D6 client rule, and the 3.2/3.5 assertions all say the same thing.

### Non-blocking notes

- N1: Consider adding `metric-history-delta-ui` "Active viewer filter hides the comparison" to the MODIFIED blocks,
  changing "the headline computed from the filtered rows" to refer to the headline rule above. Otherwise the
  archived spec has two requirements describing the filtered headline in different words.
- N2: The "Metric delta" MODIFIED clause now requires baseline identity *equality*, but D4 says the client falls back
  to the `points` lookup when `baseline.metric` is absent (an older server). Mention that fallback in the requirement
  or in D4 only, but make sure it stays consistent.
- N3: The 1.7 measurement spec (≥100k rows, 40 calls) runs inside `sbt testFull` on every CI run, like its
  precedent. Consider gating it behind an env var or tag, or record its wall time in the PR so its CI cost is
  visible.
- N4: The public-route behaviour lives in `output-routes-api` rather than `public-dashboards`. That is acceptable,
  but a one-line cross-reference in the ADDED requirement would help future readers.
