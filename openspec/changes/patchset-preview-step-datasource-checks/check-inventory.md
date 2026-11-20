# HEL-1722 check inventory

Every pre-write check of `PipelineService.addStep`, `updateStep`, `DataSourceService.createStatic`/`update`, and the
roots-only `pipeline` create, with the line it lives at on main (31094b154), what the patch-set resolver does today, and
the classification. Paths are under `backend/src/main/scala/com/helio/services/`. "dry-run" = moves into a shared
read-only function that the service write calls and the resolver calls. "apply-only" = stays inside the write, with the reason.

## 1. `pipelineStep` create (`pipelines/PipelineStepCreate.addStepReporting`)

| # | Check | Where (main) | Resolver today | Classification |
|---|---|---|---|---|
| 1.1 | Unknown `type` -> 400 `Invalid step type '<t>'. Allowed values: ...` | PipelineStepCreate.scala:37-40 | none (resolver: "keeps its apply-time 400") | dry-run (`checkAdd`) |
| 1.2 | `PipelineStep.rawConfigProblem` -> 422 | PipelineStepCreate.scala:35,41 | runs it (PatchSetPipelineStepResolvers) after access | dry-run (`checkAdd`); order moves before access (service order) |
| 1.3 | Config decode failure -> 400 `Invalid '<t>' config` | PipelineStepCreate.scala:43-50 | none (decode failure swallowed into Right(())) | dry-run (`checkAdd`) |
| 1.4 | Pipeline lookup `findByIdShared` -> 404 `Pipeline not found: <id>` | PipelineStepCreate.scala:96-99 | `authorizeEditorOrOwnerOnPipeline`: `Pipeline not found` | dry-run; preview adopts the service text |
| 1.5 | Grantee editor check (`requireEditorAccess` -> 403 `Forbidden`) | PipelineStepCreate.scala:100-103 | same rule, `Forbidden()` (identical default text "Forbidden") | dry-run |
| 1.6 | Secondary data-source ownership -> 404 `Data source not found: <id>` | StepReferenceChecks.referenceChecksF; StepReferenceChecks.scala:52-55 | `edit N: data source not found: <id>` (lower-case) | dry-run; wording flips to the service's |
| 1.7 | Lane reference (missing 422, self/ancestor/descendant/dependent 400) via `LaneScope.of` over the `resolveCreateAnchor` anchor and its re-parented seeds | PipelineStepCreate.scala:58-91; StepReferenceChecks.laneCheckF; PipelineService.validateLaneReference:370 | none | dry-run, GRAPH-DEPENDENT (D7: skipped when an earlier edit of the set touched the same pipeline) |
| 1.8 | Upsert target (existing source must be owner-owned dataset; 404 / 422) via `PipelineStepOwnership.upsertOwnershipCheck` as the PIPELINE OWNER | StepReferenceChecks.scala:56; PipelineServiceSupport.scala:160 | none | dry-run (not graph-dependent) |
| 1.9 | Placement rejections of `resolveCreateAnchor` (both ids 400, unknown root 422, root position 422, unknown parent 422, several roots 400, position out of range 422) | PipelineStepCreate.persistNewStep:156; StepPlacement.scala | none | dry-run, GRAPH-DEPENDENT (D7) |
| 1.10 | `rejectIfReparents` (opt-in, not `attachAsTail`) -> 422 `ReparentRejected` message | PipelineStepRepository.scala:742 (inside the write); mapped by PipelineService.classifyDbError:335 | none | dry-run copy computed from the same anchor (`StepPlacement.reparentedIds`), GRAPH-DEPENDENT (D7); the repo keeps its own check under the lock (authoritative). Precedence note: the 422 now precedes the write-back cycle guard (1.11) when both would fail. |
| 1.11 | Write-back cycle guard `cycleCheckForUpsertAction` -> `PipelineCycleGuard.check*Action` (400) | PipelineStepRepository insert path, run under the pipeline advisory lock as the pipeline owner on the privileged pool | none | apply-only (D6): needs an owner-identity read of the read/write edge graph on the privileged pool from a grantee's preview; same call as HEL-1638 row 1.11; the pure predicate is not fed at preview |
| 1.12 | Repo insert, position/parent linking, DB error classification (`classifyDbError`) | PipelineStepCreate.persistNewStep:160-172 | none | apply-only (it is the write) |
| 1.13 | Audit record | PipelineStepCreate.scala:168 | none | apply-only (a side effect) |

Error precedence of `addStep` is unchanged: type, config, access, ownership, lane, upsert, placement, reparent.
Preview's precedence for step create changes from (target.parentId, access, raw config, ownership) to the service's
(target.parentId, patch decode, type, raw config, decode, access, ownership, lane, upsert, placement, reparent).

## 2. `pipelineStep` update (`pipelines/PipelineStepWrites.updateStep`)

| # | Check | Where (main) | Resolver today | Classification |
|---|---|---|---|---|
| 2.1 | Step exists (`findByIdInternal`) -> 404 `Pipeline step not found: <id>` | PipelineStepWrites.scala:31-33 | `edit N: pipeline step not found` | dry-run (`checkUpdate`); wording flips to the service's |
| 2.2 | Pipeline visible to the caller (`findByIdShared`) else the same 404 (HEL-1002 masking) | PipelineStepWrites.scala:36-39 | `requireVisibleStep` (same masking) | dry-run |
| 2.3 | Editor/owner (viewer -> 403 `Forbidden`) | PipelineStepWrites.scala:41-45 | `authorizeEditorOrOwnerOnPipeline` | dry-run |
| 2.4 | Type change `req.type != existing.kind` -> 400 (before config) | PipelineStepWrites.scala:49-55 | none | dry-run |
| 2.5 | `rawConfigProblem(existing.kind, cfg)` -> 422 (config present only) | PipelineStepWrites.scala:70-73 | runs it | dry-run |
| 2.6 | Decode failure -> 400 `Invalid '<kind>' config` | PipelineStepWrites.scala:75-82 | `edit N: invalid '<kind>' config` | dry-run; wording flips to the service's |
| 2.7 | Secondary data-source ownership (404) | referenceChecksF | runs it | dry-run (wording flips) |
| 2.8 | Lane check against the existing step's parent chain, self excluded (`LaneScope.of(current, existing.parentStepId, Set(self), self)`) | PipelineStepWrites.scala:88-95 | none | dry-run, GRAPH-DEPENDENT (D7) |
| 2.9 | Upsert target as the pipeline owner | referenceChecksF | none | dry-run |
| 2.10 | Write-back cycle guard in `updateInternal` (config present) | PipelineStepRepository.updateInternal, `actingUserId = pipeline.ownerId` | none | apply-only (D6, same reason as 1.11) |
| 2.11 | `position` handling (`positionScopedUpdateAction`), enabled flag | PipelineStepRepository.updateInternal | none | apply-only (position is enforced inside the repo update, no pre-check exists; not a rejection source the service evaluates earlier) |
| 2.12 | `updateInternal` returns None -> 404 (row vanished) | PipelineStepWrites.scala:67,110 | none | apply-only (race) |
| 2.13 | Audit | PipelineStepWrites.scala:63,106 | none | apply-only |
| 2.14 | Reference checks run only when `config` is present (a type/enabled/position-only patch skips 2.5-2.9) | PipelineStepWrites.scala:57-62 | same (resolver skips when config is None) | preserved |

## 3. `dataSource` create / update

| # | Check | Where (main) | Resolver today | Classification |
|---|---|---|---|---|
| 3.1 | `DataSourceKind.canonicalize(type) == dataset` gate (patch-set only) | PatchSetDataSourceResolvers.resolveDataSourceCreate | runs it | preserved (patch-set restriction, not a service check) |
| 3.2 | `validateStatic(req, DatasetMaxRows)`: name blank 400; row cap 400 `Payload exceeds the maximum of 500 rows`; tag; column types (all bad named); defaults; row validation | DataSourceService.scala:1396-1430, called from createStatic:174 with `staticMaxRows` = `DatasetMaxRows` (:74, :1433) | none | dry-run (D4): the resolver calls the same function with the same constant |
| 3.3 | `insertDatasetSource` + audit | DataSourceService.scala:187-190 | none | apply-only (the write) |
| 3.4 | `update`: `name.trim.isEmpty` -> 400 `name must not be empty` | DataSourceService.scala:598-600 | none | dry-run: new `DataSourceService.validateUpdate(req)`, called first by `update` and the resolver |
| 3.5 | `update`: `findByIdOwned` 404 `Data source not found` | DataSourceService.scala:602-604 | `edit N: data source not found` | preserved (resolver already does it), now after the blank-name check as in the service |
| 3.6 | `dataSourceRepo.update` returns None -> 404 | DataSourceService.scala:618 | none | apply-only (race) |

Precedence flips (D4): a blank-name update of an unowned source is now 400 (was 404) in preview; a missing patch on an
unowned source is now 400 (was 404) in preview (patch presence moves ahead of ownership).

## 4. `pipeline` create, roots but no steps or Outputs (`patchsets/PatchSetPipelineResolvers.resolvePipelineCreate`)

| # | Check | Where (main) | Resolver today | Classification |
|---|---|---|---|---|
| 4.1 | Root shape (`PipelineRootWrites.shapeProblem`) and existing-source ownership | PatchSetPipelineResolvers rootsLoop | runs | preserved |
| 4.2 | `dryRun.preflight` returns `Right(None)` when there are no steps or Outputs | PatchSetPipelineResolvers `case Right(None) => Right(())` | returns without a root dry run | dry-run (D5): run `rootSchemas()` and discard the schemas |
| 4.3 | Inline static root: `validateStatic` | PipelineRootDryRun.scala:39-43 | skipped on `Right(None)` | dry-run via 4.2 |
| 4.4 | Inline sql root: `validateSqlCreate` (+ budgeted live fetch when `chargeFetches`) | PipelineRootDryRun.scala:44-46 | skipped on `Right(None)` | dry-run via 4.2; a fetch failure alone does not reject (apply records an unrunnable run) |
| 4.5 | Inline rest root: `validateRestCreate` (+ budgeted live fetch) | PipelineRootDryRun.scala:47-49 | skipped on `Right(None)` | dry-run via 4.2 (D5 records the extra live fetch at preview for a roots-only rest/sql create, the same as the with-steps path) |

## 5. Same-set graph edits (D7)

`resolveAll` resolves every edit against the stored graph before any edit applies, and apply runs `resolveAll` too. A
graph-dependent check (1.7, 1.9, 1.10, 2.8) moved into `resolveAll` would make APPLY refuse sets it accepts today. So
for a `pipelineStep` edit whose pipeline id was already touched by an EARLIER `pipelineStep` create/update/delete of the
same set, `resolveAll` passes `GraphChecks.Skip`: those four checks are judged at forward apply against the real
intermediate graph ("judged at apply when an earlier edit of the set touches the same pipeline"). Non-graph checks
(type, config, access, ownership, upsert target) always run. The key is the resolved action's pipeline id (a step
update/delete's `existing.pipelineId`, a create's `target.parentId` pipeline id), never raw text.

## 6. Wording/precedence flips in existing specs

Existing specs whose expectations moved (all other assertions in these files are untouched):

- `PatchSetPipelineStepGrantSpec`: the viewer-grantee `pipelineStep` create and update (apply and preview) now answer `Forbidden("edit 0: Forbidden")`
  (the service's own `Forbidden` message, `ServiceError.Forbidden()`'s default text is the same "Forbidden", behind the `edit N: ` prefix). The delete
  keeps the bare `Forbidden()` (not in scope).
- `PatchSetApplyServiceSpec` "refuse an upsertsource create targeting a non-dataset source" (HEL-1265): the upsert-target check now runs at resolve time, so the
  refusal is `422 edit 1: ...` before any edit applies, instead of a reported failure that rolled the earlier edit back. Nothing is ever written either way.
- `PatchSetStaleCheckRoutesSpec` "both stale and lane-cyclic" (HEL-1523): apply judges staleness on the RESOLVED edits and the lane check now runs inside
  resolve, so that edit answers the lane-cycle `400 edit 0: ...` instead of `409 PATCH_SET_STALE`. Refused and unchanged either way.
- `StepReferenceCheckDeferralSpec` "create: read the steps once": now twice (the shared placement check, then `persistNewStep`'s authoritative read; design D1).
- `ExistenceNotLeakedRoutesSpec` pinned `Forbidden` producer counts: `PatchSetApplyResolvers` 4 -> 5 (`prefixedWithEdit`'s re-wording arm, no new 403 origin),
  `PipelineStepWriteChecks` +1 (the service's own editor-grant rule, now buildable from repositories).
- `PatchSetPreviewOutputContextSpec` structural parity test: `stepWriteChecks` is a context field built by `PatchSetApplyContext.build` (like `panelDryRun`).
- Wording moved to the service's, not asserted by any pre-existing spec beyond the above: step create `Pipeline not found: <id>`, `Data source not found: <id>`;
  step update `Pipeline step not found: <id>`, `Invalid '<kind>' config`; data source update `Data source not found`.
- Step update with no patch: `400 edit N: patch is required for a pipelineStep update` now comes BEFORE the step's existence/visibility check (was 404 for an
  unknown or invisible step). Preview and apply alike; the 400 depends only on the request, so it reveals nothing about the step.
- Precedence flips (preview only; apply accepts the same inputs): step create now judges type/config/decode BEFORE editor access (the service's order);
  data-source update judges patch presence and the blank name before ownership; a doubly-invalid create gets the 422 re-parent refusal before the repo's 400
  write-back cycle guard.

Deviation recorded (C9, conservative): D5 runs the roots-only root dry run for a PREVIEW (`ctx.chargeFetches`) only. At apply the context has
`chargeFetches = false`; `PipelineService.create` re-runs the same inline-root checks authoritatively before writing, and running the dry run at apply too
would add a second live rest/sql fetch per apply and would newly refuse (as `unavailable`) apply services built without a `SourceService` (the
`PatchSetInlineSourceFixture` / `PatchSetInlineRootRollbackSpec` fixtures, undo-owned and not editable here). AC4 is preview-scoped.
Not covered by the parity corpus: the lane-dependent case for a step CREATE (needs an insert that re-parents a lane source's dependents without
re-parenting the dependent itself; update covers `DependentViaLane`).

## 7. HEL-1638 pointer

HEL-1638 `apply-check-inventory.md` section 4 and its final classification row "4 addStep placement/lane/cycle,
updateStep, DataSourceService.createStatic/update -> apply-only (deferred) -> HEL-1722" and the "roots but no steps or
Outputs" row of the patch-set pipeline create classification are RESOLVED by this change (rows 1-4 above), except the
write-back cycle guard and `position`, which stay apply-only with the reasons in 1.11, 2.10 and 2.11. Marked here (task 3.4); HEL-1638's archived inventory is left untouched.
