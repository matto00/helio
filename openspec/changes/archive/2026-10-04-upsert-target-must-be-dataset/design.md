## Context

Live tree (eda4669e). `UpsertSourceConfig.validateTargetOwnership` (UpsertSourceConfig.scala:260) checks only
`findByIdOwned` as the pipeline owner; it is the single chokepoint for `PipelineService.create` (:470), `addStep`
(:1898/:1907) and `updateStep` (:2185) via `upsertOwnershipCheckF` (:1923). Apply-proposal (`PipelineProposalService`
-> `create`), MCP `add_pipeline_step` (REST -> `addStep`), patch-set apply (`PatchSetApplyForward` -> create/addStep/
updateStep) and the UI editor all funnel there. No pipeline import exists (grep: only dashboard snapshot import, which
creates no steps). The only kind check is `DataSourceRepository.writeExistingDatasetAction` (:390-393), reached after
the real run's engine pass. `UpsertSourceStep.evaluate` only records a `PendingWrite`, so analyze/preview/dry run never
look at the target. Every PipelineRunService execution site passes `ownerUserId = Some(pipeline.ownerId)` (:529, :614,
:742, :759, :1074). The UI picker (`UpsertSourceConfig.tsx:89`) already lists `dataset` sources only.

## Goals / Non-Goals

Goals: refuse a non-dataset target at every save path (422 naming it), flag it in analyze, refuse it at every
execution surface with HEL-1147's shape, before any write. Non-goals: see proposal.md.

## Decisions

**D1 -- One predicate.** Add a single writability predicate (e.g. `DataSourceKind.isWritableDataset(kind)` =
`canonicalize(kind) == Dataset`) and use it in `writeExistingDatasetAction` (replacing its inline `Dataset || Static`
test, behaviour-identical since canonicalize maps static to dataset), in the save-time check, analyze and evaluate.
Mutation target: flipping this predicate must turn the save, analyze and preview tests red.

**D2 -- Save time: extend the chokepoint.** `validateTargetOwnership` (or a renamed sibling with the same call sites)
returns a typed outcome: `NotFound(msg)` (unchanged 404 text, unknown or foreign) vs `NotWritable(msg)` (owned, wrong
kind) -> `ServiceError.UnprocessableEntity`. Message names the target:
`Upsert target '<name>' (<id>) is a <kind> source; an existing-source target must be a dataset.`
Disclosure is safe: the name/kind are only returned after `findByIdOwned` as the pipeline owner succeeded, and the
caller already holds editor access to that owner's pipeline (same ACL as today's success path). Foreign/unknown ids
never reach the kind branch. `updateStep` checks only when config is supplied (position/enabled toggles on a stored
invalid step stay possible, matching HEL-1147 D7's tolerance).

**D3 -- Code: reuse `STEP_CONFIG_INVALID`, no sibling code.** The target id lives in the step's config, the kind of a
source is immutable after creation, the failure is deterministic and user-fixable only by editing the step -- the
definition of HEL-1147 D2's "config" class. HEL-1147's "reference" class (Join/Union/Lookup "not found") stays as is:
a missing/foreign upsert target keeps the plain-IAE path, not the marker. A sibling code would need new client
handling (`useStepCardPreview`, `outputsSlice`) for no behavioural difference; the tray already renders `reason`.

**D4 -- Execution: check inside `UpsertSourceStep.evaluate`.** Resolve the target via `ctx.dataSourceRepo.findByIdOwned`
as `ctx.ownerUserId`; non-writable kind -> `Future.failed(new StepConfigError(reason))`; not found -> plain IAE
`Data source not found: <id>` (reference class, today's text); `ownerUserId = None` -> plain IAE (fail closed, never
skip). Being in `evaluate` means it runs exactly when the step is on the evaluated path (preview scoping for free),
goes through `StepExecutionException.from` -> `isStepConfigError` -> `logExecutionFailure` WARN and
`executionFailureError` -> `StepConfigInvalid` at all five HEL-1147 sites, and fails the real run before
`applyPendingWriteBacks`. Alternative rejected: a PipelineRunService pre-flight -- would need its own path scoping per
surface and duplicate HEL-1147's wiring. `NewSource` targets and empty ids are untouched (engine
`requiredConfigProblems` already refuses the empty case).

**D5 -- Analyze.** `PipelineAnalyzeService` stays pure. `PipelineService.analyze` pre-resolves every `upsertsource`
`ExistingSource` target (non-empty id) as the pipeline owner via `findByIdOwned` (mirroring `secondarySchemas`, :973),
and passes a `targetId -> problem` map into the node analysis so the step's `validationError` names the target. Every
analyze surface that builds node projections (full analyze, the concise `{path, op, validationError}` projection at
:1126, `WorkspaceContextService` :350 if it analyzes independently) must receive the same map -- the executor greps
callers of `analyzeNodes`/`analyze` and lists each in the report. Unknown/foreign target in analyze: report
`Data source not found: <id>` (no kind/name).

**D6 -- Grants / RLS.** All three checks resolve through `findByIdOwned` (`withUserContext` + explicit owner filter),
so they are RLS-sensitive. Prove under a non-BYPASSRLS role, following `DataSourceReferenceGuardNonSuperuserSpec` /
`PipelineRunServiceUpsertSourceRlsSpec`: a dataset target passes and a CSV target is refused (save + evaluate), and a
grantee-editor caller is checked against the owner's sources.

**D7 -- Stored rows.** Kind is not part of the config, so decode/read-back is unaffected; pin with a test that lists
steps of a pipeline holding a stored non-dataset target (inserted via repository/SQL, bypassing the service check).
Report a read-only dev DB count (SQL joining `pipeline_steps` op `upsertsource` `config->'target'->>'dataSourceId'` to
`data_sources.source_type`), recorded in the report with the exact query. HEL-1252 R3 unchanged: such a step is still
a delete-blocking reference for its CSV source (pin with one assertion).

**D8 -- MCP + UI.** `helio-mcp/src/tools/write.ts:487` description: say `dataSourceId` must be a dataset source the
pipeline owner owns (one sentence; HEL-1264 touches `scripts/verify.ts`, not this file). UI: no change expected;
the executor confirms the step editor surfaces a save 422 message (existing error path) and records it.

**D9 -- Patch-set preview.** HEL-1154 may edit preview code. Only touch `services/patchsets/**` if its preview already
pre-checks upsert target ownership (then add the kind check in the same hunk for parity, minimal). If it does not,
leave it: apply funnels through D2 and is refused atomically. Report which case held.

## Risks / Trade-offs

- Existing tests that deliberately target non-dataset sources (cycle, reference-guard, existence-leak specs) break.
  The executor greps `backend/src/test`, `e2e/`, `frontend/e2e` for `existingSource`/`upsertsource` fixtures,
  classifies each as fixture-shape (repoint to a dataset, behaviour unchanged) or behaviour-pinning (update with the
  reason recorded); a fixture edited only to pass is a symptom -- justify each.
- Real-run failure text changes from the write-time "Step (upsertsource): Data source is not a dataset: <id>" to the
  STEP_CONFIG_INVALID reason; the run still ends `failed` with `error_log` set.
- One extra owner-scoped lookup per upsert evaluation and per analyze; negligible.

## Planner Notes

- Premise statically confirmed (premise-validation.md); live red repro is task 1 before any code change.
- D3 self-approved (driver asked design to decide). No migration (V116 unused). No new external dependency.
- Overlap with HEL-1154: none expected (we touch PipelineRunService only if D4 needs it; D4 lives in the step).
