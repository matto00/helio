## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 0614c979a1007fcb0a4cae3b60b4128b3d8950a5 (worktree = main plus the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.

### What I verified (with evidence)

**Both bugs are real.**
- `OutputSummaryReducer.scala:88-92`: `if (mapping.size == 1) mapping.headOption else fieldMapping.value ?? aggregation.value`.
  `metricHistoryView.ts:28-32` is the same rule.
- `buildOutputConfig.ts:91-104`: the editor writes an aggregated metric as `fieldMapping: {label?, unit?}` plus
  `aggregation: {value, agg}`. A label that is bound to a column therefore becomes the metric field. This is the
  common shape, not an edge case, so the proposal's "wider than stated" framing is correct.
- `MetricOutputPanel.tsx:54-76` with `selectMetricHistoryView` (`metricHistoryView.ts:154-159`): under `filterActive`
  the headline is `null`, so the panel shows `loadedValue`, which is computed over the loaded rows only.
  `usePanelData.ts:160,187` fetches `pageSize: 200`.

**Point 1 (D1: every write path validates fieldMapping keys): CONFIRMED.**
- REST create: `OutputService.scala:120` `validateConfig` runs before `insertInternal`.
- REST update: `OutputService.scala:229` validates the merged config before `updateOwned`.
- Single-call pipeline create: `PipelineService.scala:640` `validateOutputFieldMapping` runs before
  `insertInternalAction`.
- Proposal/MCP apply (`PipelineProposalService` → `pipelineService.create`), patch-set apply
  (`PatchSetApplyForward.scala:87,105` → `pipelineService.create`/`outputService.update`) and rollback
  (`PatchSetApplyRollback.scala:181` → `outputService.update`) all go through validated paths.
- First-run and persona templates (`FirstRunDashboardService.scala:141` → `pipelineProposalService.apply`) do too.
- `PatchSetUndoService.scala:321` re-inserts a snapshot of a previously-validated Output without re-validating.
  That is safe: the data was validated when first written.
- The V94 legacy backfill slot-filters metric/collection fieldMapping to `{value,label,unit}`
  (`V94__outputs_model.sql:668-689`).
- Conclusion: the lone-mapping branch can only ever select `value` (already covered by the next branch) or
  `label`/`unit` (the bug). Dropping it changes nothing beyond the bug.

**Point 2 (D2/D3).**
- *Filter reuse:* both `OutputService.rows` (`:349-360`) and `PublicDashboardRoutes.resolveRows` (`:155-169`) hold
  `resolvedFilter` before `listRowsPaged`, so a shared helper can take it. CONFIRMED.
- *Ordering:* `orderByFragment(None)` is `ORDER BY row_index ASC` (`NodeSnapshotRepository.scala:~306`). CONFIRMED,
  with one exception. When a `sort` is supplied, page 0's first row is NOT the `row_index ASC` first row. The client
  never sends a sort for a metric panel (sort only comes from the table's `lastQuery` replay), so this is a
  justification gap rather than a defect. See the notes.
- *Bound:* the run path already materializes every node row in memory to summarize
  (`PipelineRunService.scala:1451`). The filtered `count(*)` in `listRowsPaged` already scans every matching row.
  The projected one-cell read is the same order of cost, so it is acceptable in principle. But "If unacceptable, the
  gate decides" gives no threshold. See the notes.
- *Wire shape on the public path (DEFECT):* the public route does NOT return `OutputRowsResponse`. `resolveRows`
  returns `PagedResult[JsValue]` (`PublicDashboardRoutes.scala:137`), which is serialized generically
  (`ServiceResponse.run(...)(identity)`, `:352`) and has no `materialized` field. D2's "OutputRowsResponse gains an
  optional `metric`" and "the route adds one call" do not describe how the public wire shape changes. See CR2.

**Point 3 (D5): the escalation is WARRANTED, with one sub-case that can be decided in scope.**
- `useCrossFilterServerOps.ts:84-101` falls back to the client in four cases:
  1. The dimension is a timestamp.
  2. The column is not `eq`-capable (cardinality or category gate).
  3. A control `eq` exists on the same column.
  4. Capabilities are not ready yet (transient).
- Cases 1 and 2 would need the HEL-1188/1191 filter contract extended. That is outside this ticket, so the server
  genuinely cannot compute them in scope.
- Case 3 IS decidable without a caption:
  - The server filter already contains `col = v1`, and the client narrows to `col = v2`.
  - If v1 = v2, the server's filtered value is exact.
  - If v1 ≠ v2, the result is empty, and the loaded-rows computation of an empty set equals the full-set value.
  - So no "loaded rows" caption is ever needed for case 3. See note N2.

**Point 4 (D4: no backfill, documented): NOT ACCURATELY DESCRIBED.** See CR3.
- `OutputHistoryService.forOutput` (`:89-99`) computes `delta`/`pct` against a baseline with no field-identity check.
- For a window compare, the baseline comes from `historyRepo.nearestAtOrBefore` (`:118`) and can lie far outside the
  `points` the client receives. The client calls with no `limit` (`outputHistoryService.ts:47`), so it gets the
  default of 30.
- The client's stale-baseline guard only fires when the baseline is in `points` (`metricHistoryView.ts:132-136`).
  Otherwise `baselineStale` is `false`, and the delta against the spurious stored value IS rendered on the panel.
- Worked example: an Output with `{label: region} + aggregation {amount, sum}`, a 30d compare and hourly runs.
  - The first correct point after D1 has a baseline about 720 points back that stored `region`/`0`.
  - The panel shows an "up" delta of the whole sum (pct `null`, since base = 0).
- So D4's claim "old points drop out of the sparkline/delta" is false for window compares, on both the authenticated
  and public panels. It is not limited to the raw history API/MCP. The owner must rule on accurate facts.

**Point 5 (scope): CONFIRMED in scope.**
- The planned files are the reducer, `OutputService.rows`, `PublicDashboardRoutes`, `NodeSnapshotRepository`, the
  rows protocol, `metricHistoryView`, `MetricOutputPanel`, `PanelContent`, `panelThunks`/`panelsSlice`, and
  `usePublicPanelData`.
- None of `ci.yml`, `playwright.config.ts`, `.gitignore`, pipeline-editor or the scrubber are in the plan.
  `OutputPreviewPane` is explicitly excluded.
- The CR3 option below (a server-side identity guard in `OutputHistoryService`) touches a history service file. That
  file is not the L7 scrubber UI, but the orchestrator should confirm it does not collide with HEL-1277 before
  choosing that option.

**Point 6 (red-first):**
- 3.1: on main, the reducer returns `{field: region, ...}` (non-null) for a lone label, and a `sum` of `0` for
  `{unit} + {agg: sum}`. A `metric: null` assertion fails. RED.
- 3.2: `metric` is absent on main, so the filtered-presence assertion fails. RED. The "absent when unfiltered /
  offset>0 / non-metric" assertions PASS on main. They are guards, not reds, and must be labelled that way.
- 3.3: `resolveServerMetricField({fieldMapping:{label}})` returns `{field: label}` on main. RED.
- 3.4, lone label: on main `loadedValue = firstRow[label]` (`MetricOutputPanel.tsx:73-74`), so a value is shown. RED.
- 3.4, filtered metric: RED on main only trivially (nothing reads `metric`). If it injects a `filteredMetric` prop,
  it never exercises the wire, the thunk or the slice plumbing. See CR4.
- Seam fixture: `shared-test-fixtures/output-summary-reducer.json` currently has only the `coerce`/`aggregate`/`group`
  categories (`OutputSummaryReducerSeamSpec.scala`). The TS twin `aggregate.fixture.test.ts` does not exercise
  `resolveServerMetricField`. D1's "the shared fixture spec gains the label/unit cases" needs a new fixture category
  that BOTH sides assert. Task 3.1 should name it. See CR4.

**Contract files:**
- `schemas/outputs/output-rows-response.schema.json` has `additionalProperties: false` and no `metric` property.
- `scripts/check-schema-drift.mjs` compares `schemas/` with the protocol case classes (pre-commit).
- No task updates the schema. See CR1.

### Verdict: REFUTE

### Change Requests

1. **Missing contract update (rows schema).** Add a task, and name it in design D2:
   - Extend `schemas/outputs/output-rows-response.schema.json` with an optional `metric` object
     `{field: string, agg: string|null, value: number|null}`. The schema is `additionalProperties: false`, so it
     currently forbids the new key, and the pre-commit schema-drift check compares it with the `OutputRowsResponse`
     case class.
   - Update the description to state the "kind metric + filter + offset 0, else absent" rule.

2. **Public route wire shape is unspecified.**
   - `PublicDashboardRoutes.resolveRows` returns `PagedResult[JsValue]`, not `OutputRowsResponse`
     (`PublicDashboardRoutes.scala:131-137,352`). Adding a field to `OutputRowsResponse` does not reach it.
   - D2/D6 must say how the public response carries `metric`. Options include a dedicated public response case class
     with its own schema, or a documented envelope extension. The design must also cover what `usePublicPanelData`
     parses.
   - Add the matching delta: either a `public-dashboards` spec delta, or explicit public-route wording in the
     `output-routes-api` delta that names the shape. The parity scenario must compare like-for-like JSON.

3. **D4's residual is inaccurate. Fix it before the owner escalation.**
   - The client `pointMatches` guard does NOT hide a spurious BASELINE for a window compare, whenever the baseline
     lies outside the 30 points the panel fetches. The server's `OutputHistoryService.forOutput` computes `delta`/`pct`
     with no field-identity check, and `metricHistoryView.ts:132-136` only marks a baseline stale when it is in
     `points`.
   - Result: after D1, authenticated and public panels with `1d`/`7d`/`30d`/`custom` compares can show a delta against
     the old spurious value until retention removes it.
   - Rewrite D4's residual to say this. Then add a third option to the escalation, alongside "document" and "V117
     null-out": a server-side metric-identity guard in `OutputHistoryService.forOutput`/`resolveBaseline`, which
     treats a baseline whose stored `metric.field`/`agg` differs from the current config's resolution as no baseline.
     This option needs no migration and fixes the panel-visible residual.

4. **Make the seams testable, and name them.**
   - (a) Task 3.1 / D1: name the new shared fixture category in `shared-test-fixtures/output-summary-reducer.json`
     (e.g. `metricField`). Require BOTH `OutputSummaryReducerSeamSpec` (Scala resolver) AND
     `aggregate.fixture.test.ts` (TS `resolveServerMetricField`) to assert it. Today the TS twin only covers
     coerce/aggregate/group, so "pinned together" is not yet true.
   - (b) Task 3.4: the filtered-headline RTL must drive the real `fetchPanelPage` → `panelsSlice` → `PanelContent` →
     `MetricOutputPanel` path from a mocked HTTP rows response that carries `metric`. A prop-injected `filteredMetric`
     test proves nothing about the wire key or the slice plumbing.
   - (c) The server route spec should validate its filtered response against the updated schema from CR1, or assert
     the exact JSON key names, so the client parser and the server writer share one pinned shape.
   - (d) Label the 3.2 "absent when ..." assertions as guards. They pass on main.

### Non-blocking notes

- N1 (D3 justification): "keeps the reducer's non-aggregated first row equal to page 0's first row" holds only when
  no `sort` is sent. State that the metric value is always computed in `row_index ASC` regardless of `sort`, so a
  direct API/MCP caller with `sort` gets a defined value.
- N2 (D5 scope): the same-column control-`eq` fallback (`useCrossFilterServerOps.ts:92`) needs no loaded-rows caption.
  If the values are equal, the server value is exact. If they differ, the set is empty and the loaded computation
  equals the full-set value. Narrow the escalation to the timestamp and non-`eq`-capable cases (1 and 2 above),
  and the transient "capabilities not ready" window, and say so in D5.
- N3 (D3 bound): give the 1.5 measurement a pass criterion (e.g. p95 added latency on the stated 100k/50k node), so
  the final gate is not left to invent one. The run path already holds all node rows in memory and `count(*)` already
  scans the filtered set, so this is very likely acceptable.
- N4 (D6): state explicitly that a page-0 response WITHOUT `metric` clears the stored value on the pagination entry.
  Otherwise a cleared filter could leave a stale `filteredMetric` with a matching field/agg.
- N5: the aggregate read and `listRowsPaged`'s two queries run as separate transactions, so a run landing in between
  can make the headline and the page describe different snapshots. There is precedent (count and page are already
  separate), so this is acceptable, but D2's "can never disagree" holds for the filter only, not the snapshot.
- N6: `workflow-state.md` has `TICKET_TYPE: feature` for a bug ticket. The root cause here is confirmed by code
  reading (`OutputSummaryReducer.scala:91`, `metricHistoryView.ts:29-32`) and is unambiguous, but the final gate will
  look for the red-first evidence in 3.5.
- N7 (tasks.md): the empty "## Standing Constraints" heading should either list the driver constraints or be removed.
