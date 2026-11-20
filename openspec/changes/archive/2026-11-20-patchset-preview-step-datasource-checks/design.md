## Context

Preview (`PatchSetPreviewService`) and apply (`PatchSetApplyService`) both run `PatchSetApplyResolvers.resolveAll`
before anything is written; apply then calls the per-resource service (`PatchSetApplyForward`). HEL-1638 made the
resolvers call the services' own check functions for panels and `pipeline` create, and left four gaps (its
`apply-check-inventory.md` section 4 and final classification row "apply-only (deferred) -> HEL-1722"). Paths below
are under `backend/src/main/scala/com/helio/services/`. Verified at 31094b154:

- `pipelineStep` create: `patchsets/PatchSetPipelineStepResolvers.resolvePipelineStepCreate` runs
  `authorizeEditorOrOwnerOnPipeline`, `PipelineStep.rawConfigProblem`, and `StepReferenceChecks.secondarySourceOwnershipF`.
  `pipelines/PipelineStepCreate.addStepReporting` also runs: unknown `type` (400), decode (400), the shared chain
  `StepReferenceChecks.referenceChecksF` (access -> secondary ownership -> lane via `LaneScope.of` over the
  `StepPlacement.resolveCreateAnchor` anchor and its re-parented seeds -> upsert target via
  `PipelineStepOwnership.upsertOwnershipCheck`), then in `persistNewStep` the placement rejection of
  `resolveCreateAnchor` (400/422), then the repo insert (write-back cycle guard under a pipeline lock).
- `pipelineStep` update: `resolvePipelineStepUpdate` runs `requireVisibleStep` (visibility 404, editor 403),
  `rawConfigProblem`, decode, secondary ownership. `pipelines/PipelineStepWrites.updateStep` also runs: the type-change
  rejection (400, before config), the lane check (`LaneScope.of(current, existing.parentStepId, Set(self), selfId)`),
  the upsert-target check, then `PipelineStepRepository.updateAction` (write-back cycle guard under a lock, position).
- `dataSource` create: `PatchSetDataSourceResolvers.resolveDataSourceCreate` checks only `type == dataset`;
  `DataSourceService.createStatic` runs `DataSourceService.validateStatic(req, DatasetMaxRows)` (already public, HEL-1638).
- `dataSource` update: the resolver checks ownership; `DataSourceService.update` also rejects `name.trim.isEmpty`.
- `pipeline` create with roots only: `PatchSetPipelineResolvers.resolvePipelineCreate` calls `rootSchemas()` only on
  `preflight == Right(Some(indices))`; on `Right(None)` inline roots are never dry-run.

## Goals / Non-Goals

Goals: one check function per write, called by the service before its first write and by the resolver; apply accepts
exactly what it accepts today; a failable parity spec. Non-goals: undo (HEL-1720), migrations, cross-edit simulation.

## Decisions

**D1 Step create: `PipelineStepWriteChecks.checkAdd`.** New read-only class in `services/pipelines`
(`PipelineStepWriteChecks(pipelineRepo, pipelineStepRepo, refChecks, requireEditorAccess)`) whose `checkAdd(pipelineId,
req, user): Future[Either[ServiceError, CheckedAdd]]` is today's `addStepReporting` body up to and including the
placement resolution: type, `rawConfigProblem`, decode, `referenceChecksF` (same `laneScopeF`/`pipelineAccessF`), then
`StepPlacement.resolveCreateAnchor` over one fresh read, then the `rejectIfReparents` refusal computed from that anchor
(`req.rejectIfReparents && !attachAsTail && StepPlacement.reparentedIds(anchor, ...).nonEmpty`, the same message
`spliceInsertReportingInternal`'s `ReparentRejected` maps to; the repo keeps its own check, authoritative under the
lock). `CheckedAdd` carries the decoded config and the pipeline owner. The class is `private[services]` so `patchsets`
can call it. `checkAdd` takes `graph: GraphChecks` (`Run` | `Skip`); `Skip` omits the three graph-dependent checks
(lane, placement, rejectIfReparents) and nothing else. The service always passes `Run`.
`addStepReporting` = `checkAdd` then `persistNewStep` (which keeps its own fresh read and placement resolution: the
authoritative one, TOCTOU-safe). Error precedence is unchanged: type, config, access, ownership, lane, upsert, placement.

**D2 Step update: `PipelineStepWriteChecks.checkUpdate`.** `checkUpdate(stepId, req, user)` is `updateStep`'s body up to
its repo call: existence/visibility (404), editor (403), type change (400), and, when `config` is present,
`rawConfigProblem`, decode, `referenceChecksF`. It returns `CheckedUpdate(existing, pipeline, typedConfig: Option[Any])`
so `updateStep` needs no second lookup (it passes `pipeline.ownerId` as `actingUserId`) and the resolver has `existing`
for `priorState`. `updateStep` = `checkUpdate` then `updateInternal`. Messages unchanged. Same `graph` parameter (only
the lane check is graph-dependent on update).

**D3 Resolvers call D1/D2.** `PatchSetApplyContext` gains `stepWriteChecks: PipelineStepWriteChecks` (built in
`PatchSetApplyContext.build` from the repos it already has, so preview, apply and `DraftSaveService` cannot omit it).
`resolvePipelineStepCreate` = target.parentId presence, decode of the patch, then `checkAdd`; `resolvePipelineStepUpdate`
= patch presence, then `checkUpdate`, then the existing `priorState` capture. Errors are mapped through one
`prefixedWithEdit` (NotFound/BadRequest/UnprocessableEntity/Forbidden keep their status and gain `edit N: `). The two
resolvers' own copies (`authorizeSecondSourceForCreate`, `validateEmbeddedStepReferences`) are deleted. Where a
resolver message differs from the service's today (e.g. `edit N: data source not found: <id>` vs
`Data source not found: <id>`, `Pipeline not found`, a visible step's 404 wording), preview adopts the service message;
`PatchSetResolverMessagesSpec`/`PatchSetPipelineStepGrantSpec` assertions on the old wording are updated and listed in
the inventory. The HEL-1002 masking (an invisible pipeline answers as an absent step) is preserved by `checkUpdate`
itself (`updateStep` already masks). `Forbidden` keeps the service's message and gains the prefix like the others; the
executor confirms `ServiceError.Forbidden()`'s default text and records the before/after in the inventory. Preview's
error order for step edits becomes the service's (type/config before access on create); existing spec cases this
flips are listed in the inventory with the wording changes.

**D4 Data sources.** `resolveDataSourceCreate` keeps the dataset-type gate, then calls
`DataSourceService.validateStatic(request, DataSourceService.DatasetMaxRows)` (the same constant `createStatic` uses
via `staticMaxRows`). A new pure `DataSourceService.validateUpdate(req): Either[ServiceError, Unit]` holds the blank-name
rule; `update` and `resolveDataSourceUpdate` both call it. Both run it FIRST, before the ownership lookup
(it reads only the request, so nothing leaks), so a blank-name update of an unowned source is 400 on both sides.

**D5 Roots-only pipeline create (as shipped: PREVIEW only).** On `preflight == Right(None)` and `ctx.chargeFetches` (preview),
the resolver runs `rootSchemas()` and discards the schemas, so the same `PipelineRootDryRun.rootSchema` (inline
`validateStatic`/`validateSqlCreate`/`validateRestCreate`, HEL-1638 fetch rule 1.7, charged to the budget) runs as in the
with-steps path; a fetch failure alone does not reject. At apply (`chargeFetches = false`) it stays skipped and the inline-root
checks stay inside `PipelineService.create`'s forward write. Reason: running it at apply adds a second live rest/sql fetch per
apply, and apply services built without a `SourceService` (undo-owned fixtures) would newly answer `unavailable`. This is the
C9-conservative choice: apply accepts exactly what it did.

**D6 Write-back cycle guard and position: apply-only (decided).** The upsert cycle guard
(`cycleCheckForUpsertAction` -> `PipelineCycleGuard.check*Action`) reads the read/write edges on the privileged pool as
the PIPELINE OWNER (`actingUserId = pipelineOwnerId`) under a pipeline advisory lock. The pure predicate
(`PipelineCycleValidator.checkNoCycle`) exists, but feeding it at preview would mean an owner-identity edge read on the
privileged pool from a grantee's preview, a new privileged read path this ticket does not need; HEL-1638 row 1.11 made
the same call. It stays apply-only, recorded with this reason. `updateStep`'s `position` is enforced inside the repo
update (`positionScopedUpdateAction`): apply-only, recorded likewise. No new cycle logic is written.

**D7 Same-set graph edits: skip graph checks at resolve.** `resolveAll` resolves every edit against the stored graph
before any edit applies, and apply runs `resolveAll` too (`PatchSetApplyService.scala:87`), so a graph-dependent check
moved into it would make APPLY refuse sets it accepts today (two creates at `position: N` then `N+1`; an update dropping
D's lane to T followed by an update giving T a lane to D). C9 forbids that. So `resolveAll`'s loop tracks the pipelines
whose step graph an EARLIER edit of the set touches (any `pipelineStep` create, update or delete, taken from the
resolved action's pipeline id) and passes `GraphChecks.Skip` to `checkAdd`/`checkUpdate` for a later step edit on such a
pipeline; the service still runs them at forward apply against the real intermediate graph. Non-graph checks (type,
config, access, ownership, upsert target) always run. The inventory records each skipped check as "judged at apply
when an earlier edit of the set touches the same pipeline". Refusing such sets (HEL-1639 style) is not chosen: it is a
behaviour change.

**D8 Parity spec, oracle is the service.** `PatchSetPreviewWriteParitySpec` (embedded Postgres, own users, like
`ProposalDryRunParitySpec`). Each corpus entry runs (a) `PatchSetPreviewService.preview` on a one-edit set and (b) the
DIRECT service write (`PipelineService.addStep`/`updateStep`, `DataSourceService.createStatic`/`update`,
`PipelineService.create`) on an identical fresh fixture, never `PatchSetApplyService` as the oracle (after the fix
apply's `resolveAll` would agree with preview by construction). Assert accepted iff accepted, and preview's message ==
`s"edit 0: ${serviceMessage}"` with the same status. Families: every `addStep` rejection (type, raw config, decode,
pipeline not found, viewer 403, second source, lane self/ancestor/descendant/dependent, upsert target, each placement
rejection, `rejectIfReparents`); every `updateStep` rejection (not found, invisible, viewer, type change, config, lane, upsert); every
`validateStatic` rejection (blank name, row cap, bad tag, bad column type, bad default, invalid row); blank update
name; roots-only inline static/sql/rest refused; plus accepted cases of each kind. A rejected write must leave no row. Same-set entries (D7), run end to end through
`PatchSetApplyService` (green on main and must stay green): the two-position-create set applies; the drop-lane-then-
add-reverse-lane update pair applies; and a step create in a set whose earlier edit touches a DIFFERENT pipeline still
gets its graph checks at preview (red on main).

**D9 Red and mutation proof.** The spec is written and run on main first; the red run (each of the four gaps failing)
is committed as `red-run.md` before implementation. After the fix, mutations each delete one resolver call
(`checkAdd`, `checkUpdate`, `validateStatic`, `validateUpdate`, the D5 `rootSchemas()` call), plus one that drops the same-pipeline
guard (always `Run`), which must turn the two-position-create entry red; each turns named entries red; recorded in
`mutations.md`. Harness: a private embedded Postgres like `ProposalDryRunParitySpec`, with the services and the
patch-set context built on the non-BYPASSRLS app role `helio_app_test` (as HEL-1720's specs do), so an ownership/RLS
check that passes only under BYPASSRLS is caught.

## Risks / Trade-offs

- Message churn on preview for step edits (D3). Mitigation: preview adopts apply's wording; old-wording specs updated.
- `checkAdd` reads the graph once more on the direct route (create). Accepted: one extra indexed read per step add.
- D7: a same-pipeline multi-edit set gets its graph checks only at apply (documented, not stricter than today).
- `addStep`/`updateStep` are also called by `PatchSetApplyRollback` and `PatchSetUndoService`: the refactor reaches
  them through the service, behaviour-preserving; their specs are run (read-only for this lane, C8).
- D5 adds a live fetch at preview for a roots-only rest/sql create (charged to the source-fetch budget), the same as
  the with-steps path; recorded in the inventory.

## Planner Notes

- Self-approved: D1/D2 class placement and name; D3 message unification toward the service; D6 apply-only; D7 skip-on-same-pipeline (option a)
  over whole-set refusal (option b, a behaviour change); D8 oracle choice; D9 file names.
- C12 (red first) overrides the "tests last" ordering rule: task group 0 is the red spec and inventory.
- Escalate (do not decide) if any check turns out to need a product call, or if a migration seems needed.

## Design-gate round 2 notes (apply during execution)

- D1 precedence: moving the re-parent refusal into `checkAdd` puts it before the repo's write-back cycle guard; a
  doubly-invalid create gets the 422 instead of the 400. Record it in the inventory; acceptance is unchanged.
- Sort re-parented ids deterministically in the message (or keep the query order) so it is stable.
- Visibility: `private[pipelines]` constructor plus a `private[services]` factory that builds the support, reference
  checks and the `findGrantRole`-based editor check from repos; `PatchSetApplyContext.build` calls the factory.
- D4: patch presence also moves ahead of ownership on update (404 -> 400 for a missing patch on an unowned source);
  list it with the other precedence flips. D7: key the skip on the resolved action's pipeline id, never raw text.
