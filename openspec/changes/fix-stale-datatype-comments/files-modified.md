All paths below reflect the FULL diff against base `03480817df8a6fa9811c3291f1a1f50900c65464`
(round 1 + round 2, after addressing skeptic-final-1.md). See
`openspec/changes/fix-stale-datatype-comments/triage-findings.md` for the complete rationale and
exact per-bucket counts.

- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` — corrected the
  `inferredSchema` field doc (backfill already ran in V94); round 2 also fixed an overstatement
  (backfill only covers sources that HAD a companion type).
- `backend/src/main/scala/com/helio/domain/model/WorkspaceResourceType.scala` — corrected the
  companion-object doc's claim that a live top-level `DataType` domain case class exists.
- `backend/src/main/scala/com/helio/domain/model/model.scala` — (round 2) fixed `ImageUpload`'s
  doc, which implied `BinaryRef` still has a parent DataType/row; it doesn't (re-keyed by
  `pipelineId`/`nodeStepId`).
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringService.scala` — fixed
  "One per-DataType capability fetch" (line 261) to "per-Output"; round 2 fixed the identical
  miss at line 66 (`GroundedContext`'s doc) that the skeptic caught (CR2).
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — fixed 9
  genuinely-stale comments (corrected count from round 1's "10" — bookkeeping only) describing a
  retired "DataType registration"/"linked DataType row" mechanism.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — removed a stale ACL-callsite list entry (`DataTypeService.checkSourceLink`, a deleted class).
- `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` — fixed two doc
  blocks describing `validateTolerant` as used by `DataTypeService`; round 2 corrected round 1's
  own introduced inaccuracy (skeptic CR3) — the method is not "currently unreferenced", it's still
  exercised by `ExpressionEvaluatorSpec`; reworded to "no callers in `backend/src/main`".
- `backend/src/main/scala/com/helio/api/http/RequestValidation.scala` — fixed `validateMetricName`'s
  doc (present-tense `MetricService` caller; genuinely zero references anywhere).
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala` — fixed a
  present-tense "mirroring `DataTypeService.findById`" doc.
- `backend/src/main/scala/com/helio/services/alerts/AlertRuleService.scala` — fixed a present-tense
  "mirrors `DataTypeService`'s shape" class doc.
- `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala` — fixed the
  "Fetch-error envelope" doc's wrong field name (`dataType` -> `inferredSchema`) and mechanism.
- `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` — fixed
  `metadataFields`'s doc ("DataType registers" -> `inferred_schema` upsert).
- `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala` — fixed "runtime `DataType`
  schema" to "runtime Output schema".
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — fixed
  `toDataTypeEntry`'s doc (contradicted by its own body); round 2 removed a second, separate stale
  paragraph in the SAME class-doc block (skeptic CR1) that still asserted the constructor "takes
  `dataTypeService: DataTypeService`", contradicting both the round-1 fix and the file's own
  HEL-904 task-3.12 note a few lines below.
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` —
  fixed `WorkspaceContextOutput`'s doc (`sourceId`/`sampleRows` classified off a live `DataType`).
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceResourceSearchProtocol.scala`
  — (round 2) fixed two sites naming a nonexistent `WorkspaceContextDataType` type; the real type
  is `WorkspaceContextOutput`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — (round 2) fixed a stale method-name
  reference: `BinaryRefRepository.overwriteForDataType` was renamed to `overwriteForNode` by
  HEL-904 task 3.4.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — (round 2) fixed
  the same stale `overwriteForDataType` method-name reference, plus "The DataType schema/row/
  binary-ref writes" -> "The Output's schema/row/binary-ref writes".
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala` —
  (round 2) fixed the file header's wire-shape description: `PipelineProposal` carries
  `outputs: Vector[...]` (plural), not "an output DataType contract" (singular, retired).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — (round 2)
  fixed "output DataType" -> "Output's row snapshot" in the `blocked`/`blockedReason` doc.
- `backend/src/main/scala/com/helio/api/protocols/proposals/CombinedProposalProtocol.scala` —
  (round 2) fixed "not-yet-created output DataType" -> "not-yet-created Output".
- `backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala` —
  (round 2) fixed "an existing pipeline-output DataType by id" -> "an existing Output by id".
- `backend/src/main/scala/com/helio/api/protocols/proposals/DashboardAuthoringProtocol.scala` —
  (round 2) fixed "a per-DataType panel-capability fetch" -> "a per-Output panel-capability fetch".
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — (round 2)
  fixed "resolves to a pipeline-output DataType" -> "resolves to an Output".
- `backend/src/main/scala/com/helio/services/patchsets/RefinementGrounding.scala` — (round 2)
  fixed 3 more sites (class doc, `assemble` doc, `withWorkspaceContext` doc) with the same
  per-DataType/pipeline-output-DataType(s) pattern already fixed at this file's own line 95/96 —
  the skeptic's exhaustiveness objection (CR2/full-re-read instruction) directly caught this.
- `backend/src/main/scala/com/helio/domain/steps/ComputeStep.scala` — (round 2) fixed "output
  DataType" -> "output row schema".
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — (round 2) fixed
  the identical "output DataType" -> "output row schema" wording.
- `backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala` — (round 2) fixed "a
  DataType could advertise a dotted column" -> "an inferred schema could advertise a dotted
  column".
- `backend/src/main/scala/com/helio/services/hooks/HookTriggerService.scala` — (round 2) fixed
  "the prior DataType snapshot" -> "the prior Output snapshot".
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextComputations.scala` —
  (round 2) fixed the `computeJoinHints`/`JoinCandidate` doc block's repeated "DataType" ->
  "Output" terminology, and corrected a now-vacuous "excludes a source-companion DataType" clause
  to state plainly that no such entry exists post-HEL-904.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextBudget.scala` — (round 2)
  fixed 3 sites with the same DataType -> Output terminology drift.
- `helio-mcp/src/helioApi.ts` — `createDataSource` now sends `type: "dataset"` instead of the
  retired `"static"` wire alias; fixed the docstring one line above it to match.
- `openspec/changes/fix-stale-datatype-comments/triage-findings.md` — full rewrite (round 2):
  exact (non-approximate) per-bucket counts re-derived from a fresh grep against the current
  HEAD; documents all 9 additional genuinely-stale fixes found via the skeptic-triggered full
  re-read; corrects the `validateTolerant` spinoff recommendation (skeptic CR3) to distinguish it
  from `validateMetricName` (genuinely zero references vs. still spec-covered).
- `openspec/changes/fix-stale-datatype-comments/tasks.md` — all tasks marked complete (unchanged
  from round 1).
- `openspec/changes/fix-stale-datatype-comments/triage-findings.md` — round 3 (driver-directed,
  skeptic-final-2.md): the "uncertain" bucket's header said 6 comment lines/4 sites while its own
  listed contents already enumerated 7 lines (`RefinementPrompt.scala:108-109` is 2 separate
  grep-matched lines, and `WorkspaceAssistantTools.scala:55` was added to the list in round 2
  without incrementing the header count) across the same 4 sites — not 5, corrected back down from
  an intermediate over-correction caught before committing. Fixed the uncertain row's line count
  (6->7) and the comment-hits/total column sums that depend on it (100->101, grand total unchanged
  at 188, which was already correct); no bucket's actual contents changed.
