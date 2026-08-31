# Files modified — cycle 7 (round-4 skeptic fixes: index-space bug, stale examples, doc drift)

Scope for this cycle was explicitly limited by the human coordinator to exactly three items from
`final-skeptic-migration-correctness-4.md`'s Finding 1, `AssistantProposalToolSchemas.scala`'s
`"metric"` examples, and documentation drift (`dashboard-proposal.schema.json`,
`PatchSetPreviewProjection.scala`, the change's `patch-set-preview` delta spec). No opportunistic
cleanup.

## Item 1 — `insertAtInternal`'s index space no longer matched its callers' (round-4 Finding 1)

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` —
  new `spliceInsertAtInternal`: a real re-parenting splice-insert (inserts a step as the trunk
  continuation immediately under a given anchor `parentStepId`, re-parenting whatever previously
  occupied that position-0 slot to become the new step's own child), returning the freshly
  `SELECT`-ed persisted row rather than an echo of the request. `insertAtInternal` (sibling-scoped
  renumber only, no re-parenting) is insufficient for "insert directly after this node" — see the
  new method's doc for why. Insert-then-reparent ordering (not reparent-then-insert) is required to
  avoid violating the `parent_step_id` FK against a not-yet-existing new row id — caught by the new
  regression tests below (a real `404 Not Found` from a misclassified `PSQLException`, not a logic
  no-op).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `persistNewStep`'s
  explicit-`position` branch and `duplicateStep` now resolve the correct anchor (`current(index-1)`
  for `persistNewStep`, the target step itself for `duplicateStep`) and call
  `spliceInsertAtInternal` instead of `insertAtInternal`, fixing the case where a migrated
  (parent-chained) pipeline's single-member root sibling group silently absorbed every insert at
  the end regardless of the requested position, while the `201` response echoed the requested
  (wrong) index instead of what actually persisted.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` —
  (a) updated the 4 pre-existing flat-pipeline position assertions (`POST with position: 0`, `POST
  with position in the middle`, `POST with position equal to the current step count`, `POST with
  position heals pre-existing gaps`, `POST duplicate clones directly after the original`) to the
  correct sibling-scoped `position` values a splice-insert now produces (order/id assertions were
  already correct and are unchanged — only the raw `position` field values needed updating, since
  they're no longer a whole-pipeline monotonic index); (b) two NEW regression tests, seeding a real
  migrated-shape (parent-chained) pipeline via raw SQL — the shape the pre-existing flat-pipeline
  coverage could never exercise, since sibling group == whole pipeline for API-built pipelines —
  covering `duplicateStep` and `addStep(position=…)` respectively. Each asserts BOTH halves
  separately per the coordinator's explicit instruction: (a) the new/duplicated step lands spliced
  at the correct sibling-scoped position in `listByPipelineInternal`'s real execution order (not
  appended to the end), and (b) the response's reported `position` equals the row's actually
  persisted `position`, read back independently via `stepRepo.findByIdInternal` rather than trusting
  the create response's own echo.

## Item 2 — stale `"type": "metric"` worked examples

- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` —
  both `propose_dashboard`/`propose_combined` worked examples (lines ~88, ~207) changed from
  `"type": "metric"` (hard-rejected by `PanelType.fromString`) to `"type": "output"`, the correct
  data-panel kind for the scenario each example illustrates (a bound value/aggregation panel).
  `AssistantProposalToolSchemasSpec` (decode-pins these examples) still green.

## Item 3 — documentation drift (real defects, not cosmetic)

- `schemas/dashboards/dashboard-proposal.schema.json` — corrected 12 stale field descriptions
  (`dataTypeId`, `metricId`, `fieldMapping`, `aggregation`, `chartType`, `xAxisLabel`, `yAxisLabel`,
  `seriesColors`, `label`, `unit`, `sort`, `config`) that still named the retired
  metric/chart/table/collection/timeline panel kinds and the deleted Metrics concept as if they were
  live. Fields whose only consumer was a now-deleted panel kind are now documented as legacy
  (decoded but never applied, retained for wire/schema stability); `dataTypeId`/`fieldMapping`/
  `config` are corrected to describe the current `output`/text/markdown/image placement-kind model
  accurately (including the `dataTypeId`-is-really-an-Output-id naming note for `output` panels).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala` — corrected
  the class-level scaladoc, which still claimed the panel-update `chartType: "scatter"` +
  `aggregation` conflict check ("scatter+aggregation conflict... both free, via the reused functions
  above") was still active and mirrored by preview; `PanelService.validateScatterAggregationConflict`,
  `ChartPanel`, and panel-side `aggregation` were all deleted by this same ticket
  (`PanelServiceHelpers.scala:188-199`) — there is nothing left for `preview` to mirror there. The
  inline comment at `panelUpdateAfter` already correctly stated the removal; only the file-level
  scaladoc was stale.
- `openspec/changes/outputs-model-migration/specs/patch-set-preview/spec.md` — corrected the same
  stale claim in the "Preview enforces the panel/pipeline content-level checks apply would
  separately enforce" requirement: removed the `chartType: "scatter"` + `aggregation` bullet from
  the enforced-checks list and the requirement no longer describes the panel/pipeline checks as
  "unchanged" from the base spec (the scatter/aggregation check specifically is not).

## Housekeeping

- Committed the three pending round-4 skeptic report files (previously untracked, carried forward
  per the coordinator's instruction):
  `final-skeptic-migration-correctness-4.md`, `final-skeptic-deletion-sweep-4.md`,
  `final-skeptic-wire-contract-diff-4.md`.
