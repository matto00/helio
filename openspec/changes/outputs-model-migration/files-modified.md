# Files modified — cycle 6 (execution-order follow-on ruling + 2 smaller round-3 findings)

## Execution-order follow-on ruling (design.md's trunk/tail decision, extended)

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` —
  new `executionOrder` (pure function): whole-pipeline order derived from the `parent_step_id`
  chain — trunk in order, each node's own tail branches emitted immediately after it. `listByPipeline`
  and `listByPipelineInternal` now return this order instead of `.sortBy(_.position)`. `reorderInternal`
  rewritten to renumber `position` WITHIN each existing sibling group only (grouped by each id's
  EXISTING `parentStepId`, read fresh from the DB) — never across the whole pipeline; never touches
  `parentStepId` itself, so the position-0 = trunk-continuation invariant is preserved by construction.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` —
  `previewStep` no longer re-sorts `listByPipelineInternal`'s (now-correct) result by `.position`
  before resolving the target step's index; that re-sort would have re-broken order.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` —
  `duplicateStep` no longer re-sorts `listByPipelineInternal`'s result by `.position` before finding
  the source step's index (used as the clone's insert position).
- `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala` —
  `pipelineStateText` no longer re-sorts the step list by `.position` before rendering it into a
  patch-set refinement prompt.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` —
  new "PipelineStepRepository.executionOrder against every real multi-step pipeline" test group:
  (1) the real, DB-backed `listByPipelineInternal` (via a `liveCtx`-style `DbContext`) yields the
  pre-migration linear order for each of the 15 real multi-step pipelines' ORIGINAL steps, and (2)
  every one of the 5 real aggregate tails executes after its parent trunk step (or, for the one
  tail whose pipeline had no pre-existing steps, that pipeline has no real trunk at all).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` —
  new real-Postgres route test: seeds a 4-node, 3-sibling-group tree via raw SQL, calls the real
  `PUT /pipelines/:id/steps/order` with a request that deliberately interleaves ids across all 3
  groups, and confirms each group is renumbered independently (the root group's sole member keeps
  position 0 regardless of its index in the shuffled request) and `listByPipelineInternal`'s
  returned vector order matches the tree-derived `executionOrder`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` —
  new `previewStep` test: seeds a trunk-plus-tail tree via raw SQL, inserted deliberately OUT of
  trunk order (to defeat any accidental insertion-order/position-tie coincidence), and confirms
  previewing a deep trunk step resolves the correct 4-step prefix (composing to 1 row) rather than
  the 3-step prefix a reverted `.sortBy(_.position)` mutation would wrongly resolve (2 rows).
- `openspec/changes/outputs-model-migration/design.md` — new "Follow-on: whole-pipeline
  execution/list order..." section extending the existing binding trunk/tail decision: the conflict
  found by round 3, the ruling, the HEL-905 boundary determination (this rewire is fully P1.1's job;
  no deferral needed — HEL-905's tree-walk engine rewrite is a distinct, later change to run
  *execution*, not step *listing/ordering*), and the required proof.

All 4 fixes above (`executionOrder`-based `listByPipelineInternal`, sibling-scoped `reorderInternal`,
and the `previewStep` re-sort removal) were mutation-tested by hand this cycle: each reverted in
turn, its guarding test confirmed red, then restored to green (not left in the diff).

## Two smaller round-3 findings

- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` —
  `ProposalPanelSchema`'s `type` enum updated from the retired
  `metric/chart/table/text/markdown/image/collection/timeline` set to the current
  `text/markdown/image/output` set, matching `schemas/dashboards/dashboard-proposal.schema.json`'s
  own `type` enum exactly (no sibling tool-schema file had the same drift — grepped for
  `enumSchema("metric", "chart"...)` repo-wide, one hit).
- `openspec/changes/outputs-model-migration/specs/patch-set-preview/spec.md` — the `dataType`-update/
  `dataType`-delete content checks and impact hint (which reference the now-deleted `DataTypeService`
  and the removed `target.kind == "dataType"` recognition) moved to `## REMOVED Requirements` with a
  Reason citing task 3.3; the panel/pipeline/dataSource/dashboard checks and hints those same base
  requirements also covered are restated under new `## ADDED Requirements` entries (openspec's
  MODIFIED-delta model requires the full base scenario set or an explicit remove+add pair — a partial
  scenario drop under an unchanged title fails `openspec validate`).
- `openspec/changes/outputs-model-migration/specs/resource-tagging/spec.md` — the "Tag persists and
  is returned on reads" scenario scoped to data sources/pipelines only (an Output's `tag` is
  write-only in the shipped build — persisted by `OutputRepository.insertInternal` but never read
  back onto the domain `Output`), with an explicit note and no invented ticket reference.
- `openspec/changes/outputs-model-migration/specs/*/spec.md` (13 files: `assistant-conversation-loop`,
  `fetch-error-envelope`, `panel-data-freshness`, `pipeline-analyze-api`, `pipeline-assert-fail-policy`,
  `pipeline-execution`, `pipeline-proposal-apply`, `pipeline-run-execution`, `pipeline-schema-drift`,
  `pipeline-shape-registry`, `schema-inference`, `schema-inference-facade`,
  `workspace-context-agent-section`, `workspace-context-assembly`) — the round-2 sed's `Output/node`
  artifact (116 remaining hits, round-2 CR1's substantive remainder) replaced with the canonical noun
  `Output` throughout (articles adjusted: "a Output" → "an Output"); one collateral corruption from
  this cycle's own bulk fix (`panel-data-freshness`'s literal `node_snapshots` table-name reference,
  briefly mangled to `Output_snapshots` by the naive replace) caught and restored to the correct
  `` `outputs`/`node_snapshots` `` wording before commit;
  `assistant-conversation-loop/spec.md:6`'s `resourceType == Output` further corrected to
  `resourceType == "dataType"` (the wire-exempted literal value design.md's value-exemption decision
  already blessed — a plain `Output/node` → `Output` swap would have "fixed" the noun but left the
  wire-value contradiction round 3 also flagged).
