## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- **`openspec validate metric-grounding-catalog-binding --strict`** → `Change 'metric-grounding-catalog-binding' is valid`.
- **Worktree is clean of code changes** — `git status --porcelain` shows only the untracked
  `openspec/changes/metric-grounding-catalog-binding/` dir; `git diff main --stat` is empty. Correct
  for a design-gate review (no premature implementation).
- **No placeholders/hand-waving** — `grep -rniE "TODO|TBD|FIXME|to be determined|figure out later|placeholder"`
  across `ticket.md`/`proposal.md`/`design.md`/`tasks.md`/`specs/**` → no hits.
- **Acceptance criteria trace to tasks/specs**:
  - AC1 (`metrics` catalog in `get_workspace_context`) → tasks 3.1/3.2, spec
    `mcp-metric-tools: get_workspace_context advertises the metric catalog`.
  - AC2 (proposal `metricId` → bound panel; nothing created if invalid) → tasks 1.1–1.7, spec
    `mcp-panel-composition-tools: Proposal panels accept an optional metricId...` +
    `preValidateBindings rejects an invalid or unsupported metricId before any creation`.
  - AC3 (`propose_dashboard` warns; `applyReady` reflects it) → task 3.5, spec
    `propose_dashboard warns on a problematic metricId`.
  - AC4 (schema updated) → task 2.1.
  - AC5 (`sbt test` + helio-mcp tests pass; no FQNs) → tasks 1.8/4.5.
  - No AC is left uncovered by any task; no task falls outside the ticket's scope text.
- **D1 (field name `dataTypeId`, not `boundDataTypeId`) confirmed against real code**:
  `backend/src/main/scala/com/helio/domain/model.scala:833-846` (`MetricDefinition.dataTypeId`) and
  `backend/src/main/scala/com/helio/api/protocols/MetricProtocol.scala` (`MetricResponse.dataTypeId`,
  `jsonFormat12`). The ticket's `boundDataTypeId` is indeed informal; the design's correction is right.
- **HEL-500's actual `metricId` scope confirmed**: `grep -n "metricId"` across
  `MetricPanel.scala`/`ChartPanel.scala`/`TablePanel.scala` shows `metricId: Option[MetricId]` on all
  three; `CollectionPanel.scala`/`TimelinePanel.scala` have none. `PanelService.rejectUnresolvableMetric`
  (`PanelService.scala:508-524`) checks owned + pipeline-output-bound, and does **not** check
  `deprecated` — exactly as D3 states (the "gap" it flags is real, not fabricated).
- **`ProposalPanelSupport.scala` read in full**: `preValidateBindings` is a sequential `foldLeft` over
  panels, short-circuiting on `Left` — D5/1.3's plan to chain a metric check after the dataType check
  fits this shape exactly. `buildDataConfig` builds a flat `baseFields` map that D6's "splice `metricId`
  in unconditionally" plan extends trivially (one more `++`).
  - Verified `buildDataConfig` can also be invoked indirectly via `mergedAggregationPresent` (called from
    `validatePanel`, which runs *before* `preValidateBindings` in `DashboardProposalService.apply`) — so
    an unvalidated `metricId` could theoretically flow into a throwaway `buildDataConfig` call there. Checked:
    `mergedAggregationPresent` only inspects the `aggregation` key of the result to decide if it's a
    `JsObject`; the presence of an extra `metricId` key is inert for that check. No correctness bug.
- **D5 (`metricRepo` wiring) confirmed**: `ApiRoutes.scala:141` already passes `metricRepo` into
  `PanelService`; line 142/145 construct `DashboardProposalService`/`DashboardContentsService` **without**
  `metricRepo` today. `grep -rln "new DashboardProposalService(\|new DashboardContentsService("` across
  `backend/src` returns only `ApiRoutes.scala` — no test file constructs these directly (they go through
  `ApiRoutes` via `ApplyProposalSpecBase.scala:125`), so adding a constructor param is a single-call-site
  change with no fan-out risk to the existing `DashboardApplyProposal*Spec.scala` family.
- **D7 (wire format) confirmed**: `DashboardProposalProtocol.scala`'s hand-written `RootJsonFormat` for
  `ProposalPanel` uses exactly the `p.dataTypeId.foreach(v => fields("dataTypeId") = JsString(v))` pattern
  D7 says to mirror for `metricId`.
- **D2 (pipelineShapes precedent) confirmed verbatim**: `openspec/specs/mcp-pipeline-shape-tools/spec.md:52-58`
  has the exact `get_workspace_context advertises the shape catalog` requirement shape the new
  `mcp-metric-tools` requirement mirrors; `context.ts:980-1097` shows the real `Promise.all` fan-out and
  `.items`-unwrapping convention (`sourcesPage.items`, `dashboardsPage.items`) that `api.listMetrics()`
  (`Paged<MetricResponse>`) will follow.
- **Risk items in design.md are real, not invented**: `context.test.ts`'s `makeFakeApi()` (line ~487)
  stubs `listPipelineShapes` but has no `listMetrics` stub — confirmed by grep, matching the design's
  flagged risk. `helio-mcp/src/tools/proposal.test.ts` does not exist (`find` returns nothing) — confirmed.
- **Frontend `ProposalPanel` type not touched — checked this is not a silent gap**: a *third*,
  independent `ProposalPanel` interface exists at
  `frontend/src/features/dashboards/types/proposal.ts` (used by the in-app Proposal Review UI), which
  is already missing several real wire fields (`aggregation`, `sort`, `config`) that predate this
  ticket — so its incompleteness is pre-existing, not introduced here. Traced the Review UI's edit path
  (`ProposalReview.tsx:49`, `{ ...p, title }`) — it spreads/preserves the panel object rather than
  reconstructing it field-by-field, so an untyped `metricId` would survive round-trip at runtime even
  without a TS field for it, consistent with how `aggregation`/`sort`/`config` already behave today. The
  design's Impact section correctly scopes this change to `helio-mcp` + backend only, and the existing
  spec requirement `Proposal config passthrough is backward compatible` (already in
  `openspec/specs/mcp-panel-composition-tools/spec.md:143-157`, not part of this delta) already covers
  the general "Review UI still round-trips" guarantee this change doesn't disturb.
- **Scope/Non-Goals check**: ticket's own "Out of Scope" (metric authoring UI, governance) plus the
  design's added Non-Goals (backend `GET /api/workspace/context` parity, `CollectionPanelConfig`/
  `TimelinePanelConfig` metricId support, relaxing `dataTypeId`-required, changing
  `PanelService.rejectUnresolvableMetric`) are all narrowing/clarifying, not scope-expanding, and are
  each traceable to a real ambiguity in the ticket's prose (self-documented in "Planner Notes").
  `DESIGN_QUESTIONS: null` in `workflow-state.md` is consistent with no unresolved ambiguity requiring
  escalation.
- **Follow-up item from the prior BLOCKER round verified fixed**: `tasks.md` task 3.6 and
  `specs/mcp-panel-composition-tools/spec.md`'s `Tool description documents metricId` scenario
  (lines 31-35) are both present and read as intended — confirmed by direct read, not by trusting the
  orchestrator's note.

### Verdict: CONFIRM

### Non-blocking notes

- Task 4.1 doesn't explicitly say the new `DashboardApplyProposalMetricBindingSpec.scala` needs to seed
  a `deprecated: true` metric fixture and a foreign-owner metric fixture in addition to a valid one —
  implied by "valid/foreign/deprecated/unsupported-type" but worth the executor double-checking test
  data setup mirrors `ApplyProposalSpecBase`'s existing seeded-fixture pattern (pipeline-output/companion/
  other-user DataTypes) for metrics.
- `buildDataConfig`'s incidental invocation via `mergedAggregationPresent` before `preValidateBindings`
  runs (noted above) is harmless today, but if a future change ever makes `buildDataConfig`'s result
  observable pre-validation, this coupling is worth a comment. Not a blocking concern for this change.
