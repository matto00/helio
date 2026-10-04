## Context
Apply builds `PatchSetApplyContext(..., accessChecker, outputRepo)`; preview builds it without `outputRepo`, so the default null reaches `PatchSetApplyResolvers.findOwnedOutput` (:773) and `resolveOutputUpdate` (:792). Design-gate round 1 (skeptic-design-1.md) additionally found: (a) `PatchSetPreviewProjection.computeAfter` has no case for `ResolvedAction.OutputUpdate`/`OutputDelete` (sealed trait, no wildcard) so wiring alone would turn the NPE into a MatchError (still 500); (b) `PatchSetApplyResolvers.scala:673` silently degrades `boundOutputs` to empty when `ctx.outputRepo == null` (pipelineStep delete preview under-reports vs apply); (c) `outputRepoOpt.orNull` at ApiRoutes:240/:532 keeps null reachable in prod when there is no DbContext.

## Decisions
1. **Wire outputRepo.** `PatchSetPreviewService` takes `outputRepo` and passes it into the context; ApiRoutes:538 and the 6 test construction sites (ClaudeRoutesChatGateSpec, RefinementRoutesSpec, PatchSetRoutesSpec, PatchSetPreviewRoutesSpec, PatchSetPreviewServiceSpec, RefinementServiceSpec) are updated.
2. **Shared context factory.** Extract `PatchSetApplyContext.build(...)` (or equivalent) used by BOTH `PatchSetApplyService` and `PatchSetPreviewService`, and remove the `= null` default on the case class field. `PatchSetApplyService`'s own constructor `outputRepo = null` default: decide in implementation; if it stays, the parity test constructs apply through the same path.
3. **Typed rejection for a missing outputRepo.** `outputRepoOpt.orNull` keeps null reachable when no DbContext is configured, so the compile-time claim is NOT relied on. `resolveOutputUpdate`/`resolveOutputDelete`/`findOwnedOutput` return a typed ServiceError (not an NPE) when `ctx.outputRepo == null`, applying equally to apply and preview; the `:673` guard is either kept as an explicit documented degradation or replaced by the same typed handling (decided and recorded in the audit table).
4. **Projection learns Output.** Add `computeAfter` cases: `OutputUpdate` (after = prior output response with name/config patch applied, using `UpdateOutputRequest(name, config)` with validation parity to `OutputService.update`) and `OutputDelete` (after = None/null). Impact: `PatchSetPreviewImpact` falls to its `case _` empty hint for outputs unless a bound-panels hint is cheap and grounded; the decision is recorded in the audit table. Remove any wildcard that would hide a future unhandled `ResolvedAction` where feasible, and add a test that previews every `ResolvedAction` variant.
5. **Audit method.** Enumerate (a) every `PatchSetApplyContext` field and every `ctx.<field>` dereference AND every `ctx.<field> == null` / `Option(ctx....)` guard across Resolvers/Projection/Impact, and (b) every sealed `ResolvedAction` case vs projection and impact, per (kind, op) in the matrix: create/update/delete for panel, dashboard, dataSource, pipeline, pipelineStep; output update, output delete, and output:create (rejected 400). Record the table in the PR.
6. **Parity test.** Via the shared factory: build the context through the PatchSetPreviewService path and the PatchSetApplyService path with distinct non-null mock repos; reflect over `PatchSetApplyContext`'s fields (productElementNames/productIterator) and assert every field of the preview-built context is non-null and identical to the repo supplied. A new field defaulted null and unwired in preview fails it. Concrete mutation: drop `outputRepo` from preview's context -> parity test + output preview tests go red.
7. **Write-free proof.** For every supported (kind, op) in the matrix, snapshot row count + content checksum of ALL public-schema tables (full-schema, covers outputs, output configs, node_snapshots, bindings, permissions, audit/journal e.g. patch_set_applications, pipeline_runs) before and after preview and assert equality. Failability mutation: temporarily insert a write in `project()` and show red.
8. **ExistenceNotLeakedRoutesSpec** (backend/src/test/scala/com/helio/api/http/): add an Output target to `Seeded`/`targetIdOf` (seed a pipeline output); add distinct apply AND preview rows for `output:update` and `output:delete` (patchKinds); remove the exemptions at ~:496-497 (the guard fails on stale exemptions). Foreign vs absent ids give byte-identical 404 ("Output not found", constant from findOwnedOutput; the second message "edit N: output not found" in resolveOutputUpdate is unreachable for foreign ids because findOwnedOutput rejects first).
9. **Red first.** Before touching main code, add tests that assert 200 + Output-level diff (so they stay red for the MatchError cause too, not just the NPE) and capture the command and the observed 500 output. Tests then go green only when both wiring and projection are fixed.

## Audit Table (task 2.4, recorded by the executor)

### A. `PatchSetApplyContext` fields vs. what every resolver/projection/impact dereferences

| Field | Dereferenced by | Preview wiring before | After HEL-1239 | Null handling |
|---|---|---|---|---|
| `panelRepo` | resolvePanelUpdate/Delete (`findById`), buildPipelineStepDeletePriorState (`findByOutputIdInternal`), Impact DashboardDelete (`findAllByDashboardId`) | wired | wired (`build`) | n/a (never null in either service) |
| `dashboardRepo` | resolveDashboardUpdate/Delete (`findById`) | wired | wired | n/a |
| `dataSourceRepo` | validateEmbeddedStepReferences, resolveDataSourceUpdate/Delete, resolvePipelineCreate, authorizeSecondSourceForCreate, Projection.pipelineCreateAfter (`findByIdOwned`) | wired | wired | n/a |
| `pipelineRepo` | authorizeEditorOrOwnerOnPipeline, requireVisibleStep, resolvePipelineUpdate/Delete | wired | wired | n/a |
| `pipelineStepRepo` | resolvePipelineStepUpdate/Delete (`findByIdInternal`, `rootIdOfStep`) | wired | wired | n/a |
| `accessChecker` | authorizeEditorOnDashboard, resolveDashboardUpdate | wired | wired | n/a |
| `outputRepo` | findOwnedOutput, resolveOutputUpdate (`findConfigById`), buildPipelineStepDeletePriorState (`listByPipelineInternal`, `findConfigsByIdsInternal`) | **NOT wired (`= null` default) -> NPE (500)** | wired via `PatchSetApplyContext.build`; `= null` default REMOVED | `ApiRoutes` still passes `outputRepoOpt.orNull` (no DbContext): findOwnedOutput and resolvePipelineStepDelete return typed `ServiceError.InternalError("Output repository is not configured")` (tested), never an NPE |

### B. Every `== null` / `Option(...)` guard on a context field

| Site | Before | After |
|---|---|---|
| `PatchSetApplyResolvers.buildPipelineStepDeletePriorState` (was :673) | null `outputRepo` silently degraded to `boundOutputs: []` (preview under-reported vs apply; undo would lose bound Outputs) | guard REMOVED; the typed rejection moved up into `resolvePipelineStepDelete` (`case Right(_) if ctx.outputRepo == null`), for apply and preview alike. Test: preview `before` == apply `priorState`, `boundOutputs` has 1 entry |
| `findOwnedOutput` | none (NPE) | explicit null guard -> typed `InternalError` (covers resolveOutputUpdate/Delete) |
| `PatchSetApplyService` ctor `outputRepo = null` | defaulted | default REMOVED (compile-enforced; 6 fixtures updated); `PatchSetUndoService`'s own `outputRepo = null` default is a different context (`PatchSetUndoContext`), out of scope |

### C. Every `ResolvedAction` case x (kind, op): projection (`computeAfter`) and impact

| (kind, op) | ResolvedAction | Projection | Impact | Covered by |
|---|---|---|---|---|
| panel update / delete / create | PanelUpdate / PanelDelete / PanelCreate | after / None / after | empty | matrix |
| dashboard update / delete / create | DashboardUpdate / DashboardDelete / DashboardCreate | after / None / after | empty / cascade-count hint / empty | matrix |
| dataSource update / delete / create | DataSourceUpdate / DataSourceDelete / DataSourceCreate | after / None / after | empty / cascade hint / empty | matrix |
| pipeline update / delete / create | PipelineUpdate / PipelineDelete / PipelineCreate | after / None / after | stale hint / stale+cascade / empty | matrix |
| pipelineStep update / delete / create | PipelineStepUpdate / PipelineStepDelete / PipelineStepCreate | after / None / after | stale / stale / empty | matrix |
| **output update** | OutputUpdate | **NEW** after = prior with name replaced and config merged via shared `OutputService.mergeConfig`, fieldMapping validated via shared `OutputService.validateFieldMapping` (400 parity with `OutputService.update`); `updatedAt` kept at prior | **empty, decided**: an explicit case (not a wildcard accident); a panel-cascade hint would need a panel lookup preview does not otherwise make | matrix + route test |
| **output delete** | OutputDelete | **NEW** after = None | **empty, decided** (as above) | matrix + route test |
| output create | none (rejected `BadRequest` in resolveEdit) | n/a | n/a | dedicated test (400, write-free) |
| dataType (any) | removed (HEL-904) | n/a | n/a | n/a |

`PatchSetPreviewProjection.computeAfter` has no wildcard (sealed match, compiler-checked); `PatchSetPreviewImpact`'s `case _` remains and only covers kinds that are explicitly empty. The "every variant" test enumerates `ResolvedAction`'s sealed subclasses by scala-reflect and fails if the matrix does not produce each one, so a new case cannot ship without a matrix row (and so a projection).
