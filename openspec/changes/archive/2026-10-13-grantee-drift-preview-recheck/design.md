## Context

- Baseline read: `PipelineRepository.findLastSourceSchema(id, user)` (PipelineRepository.scala:600) filters
  `ownerId === caller` under `withUserContext(caller)`. Its only production caller is
  `PipelineAnalyzeReads.scala:149`, reached after `findByIdShared(pipelineId, Some(user))` (:41) confirmed access.
  Tests read it directly as the owner (PipelineRunServiceSpec.scala:818-866).
- Compare side: analyze reads every root's source with `dataSourceRepo.findByIdOwned(dsId, user)` (:77), and the
  drift diff uses `rootSchemas.headOption` (the lowest-positioned root, :91). For a grantee who does not own the
  owner's source this is `Vector.empty`. So fixing ONLY the baseline read turns "never drift" into "every baseline
  column removed" -- a wrong answer instead of a missing one.
- Capture side (HEL-1503 D2): the baseline is stored as the OWNER sees the source, via
  `DataSourceRepository.findByIdOwnedByInternal(id, ownerId)` (DataSourceRepository.scala:~190).
- Preview: `PipelineRunPreview.previewAtNode` (:134) gates once on `findByIdShared`, then resolves roots and steps and
  calls `backend.execute` (source-level arm ~:178, step arm ~:263). Only a closure with an enabled AI step re-checks
  owner-or-editor (`findGrantRole`, :243-251, HEL-1108). Viewers may preview non-AI closures
  (PipelineRunServiceSpec "still permits a viewer grantee to preview a closure with NO AI step").
- HEL-1503 D4 added `PipelineRunRepository.checkRunAuthorizationInternal` + `RunAuthorization`
  (`Authorized | NotAuthorized | PipelineGone`) for dry runs. `PipelineRunPreview` is not given a
  `PipelineRunRepository` (PipelineRunService.scala:158).
- `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` counts `PipelineRunPreview.scala -> 1` (:534).

## Goals / Non-Goals

**Goals:** a grantee's analyze reports exactly the owner's drift (AC1); a preview whose access is lost between its ACL
read and execution answers 403/404 and never executes (AC2).
**Non-Goals:** see proposal. No migration (V130 is the highest on main; none is needed). No response-shape change.

## Decisions

### D1 -- Privileged baseline read keyed by the already-authorized pipeline id
Add `PipelineRepository.findLastSourceSchemaInternal(id: PipelineId): Future[Option[String]]` under
`withSystemContext`, filtering by id only (doc + inline `withSystemContext:` justification, same shape as
`updateLastSourceSchemaInternal`). Analyze calls it for EVERY caller (owner included -- for the owner the result is
identical, so one path, no `ownerRun` branch to get wrong). The owner-scoped `findLastSourceSchema` stays (tests use
it as the owner's measurement); its doc names analyze no more. Alternative rejected: branch owner vs grantee as the
write path does -- the write must branch (RLS refuses the owner-scoped write for an editor); a read keyed on an id
access was just confirmed for has nothing to branch on.

### D2 -- Drift's current schema is read in the owner's view
For the drift diff only, resolve the primary root's source (first entry of `listRootDataSourceIdsInternal`, the same
root `rootSchemas.headOption` names) with `dataSourceRepo.findByIdOwnedByInternal(dsId, pipeline.ownerId)` and use
its `inferredSchema` (`Vector.empty` when `None`), exactly mirroring capture. `rootSchemas`/`schemasByRoot`/
`sourceSchemas`/projections/cost inputs keep `findByIdOwned(dsId, user)`. For the owner both reads are identical, so
owner behaviour is unchanged. Rejected: switching all of analyze to the owner's view (widens what a grantee sees of the
owner's sources well beyond drift; not asked for). Disclosure note: drift names columns of an owner source the grantee
cannot list; a grantee can already see those columns' rows via preview/run (executed with `ownerUserId`), so no new
information class is exposed -- recorded as assumed call A1.

### D3 -- Preview re-verifies access right before every execution
Add a privileged, read-only `PipelineRepository.checkPreviewAccessInternal(id, user, requireEditor: Boolean):
Future[PipelineRunRepository.RunAuthorization]` (reuses the existing ADT; `withSystemContext`): no pipeline row ->
`PipelineGone`; caller is owner -> `Authorized`; else a `pipeline` permission row for the caller whose role is
`editor` (when `requireEditor`) or any role (otherwise) -> `Authorized`; else `NotAuthorized`. Placed on
`PipelineRepository` (which `PipelineRunPreview` already holds, next to `findGrantRole`) rather than the ~700-line
`PipelineRunRepository` HEL-1503 item 3 wants split.
In `previewAtNode`, call it immediately before EACH `backend.execute`: source-level arm with
`requireEditor = false`; step arm with `requireEditor = closureHasEnabledAiStep`. This REPLACES the step arm's
`authorizedForAi` pre-check (it is the same predicate, now also covering non-AI closures and pipeline deletion), so a
viewer's AI-closure preview still answers 403 with zero model calls. Map `NotAuthorized -> Forbidden("Forbidden")`,
`PipelineGone -> NotFound("Pipeline not found: <id>")`. The step-not-found / disabled-step / 422 config checks keep
their current order before it. Roots and steps cascade with the pipeline (V98, V23), so a pipeline deleted right after
the ACL read lands in `previewAtNode`'s `roots.isEmpty` 422 branch (PipelineRunPreview.scala:141-144), never the
re-check. Mirror HEL-1503 D3 (PipelineRunExecutor.scala:55-62) there: privileged `pipelineRepo.findByIdInternal`
existence check, `None -> 404`, `Some -> the existing 422` (assumed call A3). Add this branch to
`findByIdInternal`'s privileged-caller doc list (PipelineRepository.scala:55-62), as HEL-1503 did for the executor:
a read-only existence check keyed by the id `findByIdShared` just authorized. The re-check's own docs cross-reference
`PipelineRunRepository.submitterMayRunAction` (and that doc references it back) since both encode owner-or-editor. `previewOutputs` gets this through `previewAtNode` (each node call re-checks).
Existence signal: a just-revoked caller can tell 403 from 404 -- the same accepted signal as HEL-1503 owner ruling A.
`ExistenceNotLeakedRoutesSpec`: update `PipelineRunPreview.scala`'s count to the real number of
`ServiceError.Forbidden` producers after the change AND rewrite the classification comment at
ExistenceNotLeakedRoutesSpec.scala:519-520 to describe the new producer(s) (reached only after `findByIdShared` returned
the pipeline). Never loosen the spec's mechanism.

### D4 -- Tests (red first, NOBYPASSRLS)
New `Hel1516GranteeDriftPreviewSpec` in `backend/src/test/scala/com/helio/services/pipelines/`, modelled on
`Hel1503EditorRunGapsSpec` (VerifiedEmbeddedPostgres, service under a NOSUPERUSER NOBYPASSRLS role, seeding and
measuring on the privileged pool). Throwaway users with `@example.test` emails. Cases (a), (d), (e), (f) are DEFECT
proofs: each is shown red on unchanged main. Cases (b), (c), (g) are GUARDS/PINS (they pass on main by construction) and
are labelled as such in the spec; (b) and (g) are each shown failable by their named mutation, (c) is a pure regression
pin with no mutation. Every mutation is recorded in `red-run.md` (full paths, commands, observed output):
(a) owner-owned primary source, owner real run sets baseline, source schema then changed via the privileged pool;
    editor AND viewer analyze `sourceSchemaDrift` == owner's analyze `sourceSchemaDrift` and is non-empty
    (red: `None`). Mutation M1: analyze back on `findLastSourceSchema(id, user)`.
(b) GUARD: same pipeline, schema unchanged since the baseline: editor/viewer get NO drift. Mutation M2: drift current schema
    read with `findByIdOwned(dsId, user)` (red: every column "removed").
(c) PIN: owner analyze unchanged (no mutation).
Preview seams. R "revoke after the LAST ACL read": the grant row is deleted (privileged pool) when
`pipelineStepRepo.listByPipelineInternal` or `pipelineRepo.listRootDataSourceIdsInternal` (the overridable reads under
`resolveAllRootDataSourcesInternal`) is read inside `previewAtNode` -- i.e.
after `previewAtNode`'s own `findByIdShared` (:135), never after the all-Outputs arm's outer read (:80), which the
inner read would already catch as 404 on main. S1 "delete after the ACL read" (pipeline deleted by a `findByIdShared`
override after it returns -> roots empty); S2 "delete after roots/steps resolve" (deleted at the step-list read).
(d) step preview, NON-AI closure (an AI closure is already 403 on main), seam R: editor -> 403 and viewer -> 403, spy
    backend `execute` count 0. Mutation M3: skip the re-check.
(e) output preview, seam R placed after the inner read: single-Output arm and all-Outputs arm -> 403, spy never
    executes. Same mutation M3. The all-Outputs fixture has exactly ONE distinct node key (`Future.traverse` starts
    node previews concurrently, so several keys could race 403 vs 404).
(f) S1 (fires after `previewAtNode`'s own `findByIdShared`, never the all-Outputs outer read at :80 -- outputs
    cascade with the pipeline, V94:208, so that arm would answer 200 `outputs: []` on main and after): step preview
    and the SINGLE-Output arm with a source-bound Output -> 404 "Pipeline not found", spy never executes (red on main:
    422). Mutation M4a: drop the empty-roots existence check. S2 (deleted at the step-list read, so only the step arm
    and a step-bound single-Output preview reach it): -> 404 asserting the "Pipeline not found" message (not "Step not
    found"), spy never executes. Mutation M4b: map `PipelineGone` to 403.
(g) GUARD: live viewer non-AI preview 200; viewer AI-closure preview 403 with zero model calls; editor AI-closure preview
    allowed (pins for the replaced `authorizedForAi`). Mutation M5: `requireEditor = false` on the step arm.
Existing suites that must stay green: PipelineRunServiceSpec, PipelineRunRoutesSpec, OutputRoutesSpec,
ExistenceNotLeakedRoutesSpec, Hel1503EditorRunGapsSpec, PipelineRunEditorPersistenceSpec, plus every spec whose name
matches `*Analyze*` or `*Preview*` under backend/src/test.

## Risks / Trade-offs

- [One more indexed read per preview execution] -> previews are interactive and already do several reads.
- [Owner-view drift for a grantee] -> intended; see A1.
- [Race after the re-check] -> accepted, identical to HEL-1503 D4.

## Assumed product calls (overnight -- owner asleep; PR carries OWNER REVIEW and is parked unmerged)

- A1: a grantee (viewer or editor) sees the drift the OWNER would see -- baseline and current schema in the owner's
  view; the rest of analyze stays in the grantee's view. Alternative: report drift only from the grantee's own view
  (would show nothing or spurious removals for owner-only sources).
- A2: the ticket text says "re-check owner-or-editor". Taken literally that would stop viewers previewing at all,
  reversing HEL-279/HEL-1108's explicit "viewer may preview a non-AI closure". Assumed instead: the re-check enforces
  the access the preview already required (any grant for non-AI, owner-or-editor for AI). Revoked editor -> 403 either
  way, which is the ticket's stated outcome.
- A3: a preview of a pipeline deleted mid-request answers 404 (was 422 "DataSource not found"), mirroring the owner's
  HEL-1503 ruling A for runs (gone -> 404, revoked -> 403). Not in the ticket text; planner-added for consistency.

## Planner Notes

- Self-approved: no migration; reuse `RunAuthorization` rather than a new ADT; method on `PipelineRepository`.
- Self-approved: keep `findLastSourceSchema` for its test callers rather than rewriting six assertions.
