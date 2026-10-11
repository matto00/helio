## Context

See proposal.md and ticket.md. Base is origin/main dae4bc451 (HEL-1479 merged). HEL-1479's evidence is in
`openspec/changes/archive/2026-10-10-split-patchset-apply-resolvers/` (mutation-evidence.md). Paths below are relative
to `backend/`; `patchsets/` abbreviates `src/main/scala/com/helio/services/patchsets/`.

Facts checked while planning (re-verify; they are claims, including the driver's):
- `PatchSetResolverSupport` (requireTargetId, authorizeEditorOnDashboard, authorizeEditorOrOwnerOnPipeline,
  requireVisibleStep, decodeCreatePatch) stayed in `patchsets/PatchSetApplyResolvers.scala`, as did `resolveEdit`'s
  dispatch and the three dashboard resolvers. `PatchSetApplyResolvers.scala` is the only patch-set file calling
  `requireAccess(` or producing `ServiceError.Forbidden(` (4). The five new files call no access helper.
- `authorizeEditorOrOwnerOnPipeline` is reached by pipelineStep update and delete (through `requireVisibleStep`) and
  by pipelineStep create (directly), for both `/api/patch-sets/apply` and `/api/patch-sets/preview` (preview shares
  `resolveAll`). No test file grants a pipeline role and then submits a pipelineStep patch-set edit (grep for
  `pipelineStep` near `grant`/`editor`/`viewer` in `src/test` finds nothing).
- `ExistenceNotLeakedRoutesSpec.Row.sites` is read only by the completeness guard (`rows.flatMap(_.sites)` must cover
  `filesCallingAccessHelpers()`). The output rows' foreign arm is `PatchSetOutputResolvers.findOwnedOutput`
  (non-owner -> `NotFound("Output not found")`); that file calls no access helper, so it is not in
  `filesCallingAccessHelpers()` and `sites` there is documentation. The panel and pipelineStep rows' gates
  (`authorizeEditorOnDashboard`, `requireVisibleStep`/`authorizeEditorOrOwnerOnPipeline`) are in
  `PatchSetResolverSupport`, i.e. still in `PatchSetApplyResolvers.scala`, so those labels are correct and stay.
  `PatchSetApplyResolvers.scala` must remain in some row's `sites` (it calls `requireAccess`).
- `patchSetDispatchPairs()` reads `PatchSetApplyResolvers.scala` (dispatch stayed there) - correct, untouched.
  `expectedForbiddenProducers` `PatchSetApplyResolvers.scala -> 4` - correct, untouched.

## Goals / Non-Goals

Goals: the pipeline-grant branches of the patch-set step gate pinned by failable tests (priority); the other
editor-grant paths audited for the same gap; the `requireTargetId` and `decodeCreatePatch` messages asserted; output
row labels corrected with proof; stale citations fixed; explicit item 8/9 decisions.
Non-goals: any behaviour change (C1); splitting files; editing archived evidence.

## Decisions

**D1 - Red-first by mutation (all new tests).** The code is believed correct, so "red first" means: apply a one-line
mutation to the exact branch the test guards, run the new test, show it RED with an attributable failure, revert,
show GREEN. Mutations are applied/reverted by a small script kept in the run evidence dir
(`/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/`), never committed; `git diff -- src/main` after
each revert shows only comment edits. Record each in `mutation-evidence.md` in the change dir (mutation, test, red
excerpt, green excerpt).

**D2 - Item 7 (priority): pipeline-grant tests for the patch-set step gate.** New spec file
`src/test/scala/com/helio/services/patchsets/PatchSetPipelineStepGrantSpec.scala` (`VerifiedEmbeddedPostgres.start`,
same harness shape as `PatchSetApplyServiceSpec`, its own `grantRole` helper inserting a `resource_permissions` row).
Owner A owns a pipeline with one step; user B is granted `pipeline` role `editor` or `viewer`. Tests, each through the
real service entry point (apply via `PatchSetApplyService`, preview via `PatchSetPreviewService`, or the routes if the
harness makes that simpler - executor's choice, state it):
- editor grantee: pipelineStep update (apply) succeeds and the step changes; delete (apply) succeeds; create with
  `target.parentId` = pipeline (apply) succeeds; update (preview) is accepted.
- viewer grantee: update, delete, create (apply) each -> `ServiceError.Forbidden` (HTTP 403), nothing mutated; update
  (preview) -> 403.
- no grant: unchanged existing coverage (absent-step / `Pipeline not found` 404 via `ExistenceNotLeakedRoutesSpec`).
Mutations (each one line in `authorizeEditorOrOwnerOnPipeline`):
- M7a weaken: `case Some("editor") => Right(())` -> `case Some(_) => Right(())` (any grant passes) - the viewer tests
  must go RED.
- M7b tighten: `case Some("editor") => Right(())` -> `case Some("editor") => Left(ServiceError.Forbidden())` - the
  editor tests must go RED.
- M7c owner branch: `pipeline.ownerId == user.id` -> `false` - record which tests go red (owner paths are expected to
  be covered already; if nothing goes red, add an owner-accept test).
**Assertion strength (design gate 1 note):** assert the exact `Left(ServiceError.Forbidden(...))` from the
service (or HTTP 403 at the route), never a weak `a[Left[_, _]]` or "nothing mutated" check alone: forward apply
re-checks editor access through `PipelineService` (`requireEditorAccess`), so under M7a a viewer apply still mutates
nothing but returns `Right` with a `failure` (HTTP 200). Only the exact pre-validation 403 goes red. The same applies
to any D3 survivor test on the dashboard viewer branches.
**Escalation rule (owner instruction):** if any editor/viewer test fails against UNMUTATED code because the behaviour
differs from what `PipelineService.requireEditorAccess` (the REST step path's rule: owner or `editor` grant, viewer
403) enforces, that is a real authorization bug: STOP, do not change the assertion or the code, report it to the
orchestrator as an `ESCALATION`.

**D3 - Item 7 audit: other editor-grant paths.** For each grant-role branch listed below, apply a let-viewer-through
mutation (and, where a separate editor-accept branch exists, an editor-rejected mutation), run the specs that exercise
that service (selected by grep of the service/route name in `src/test`, plus `ExistenceNotLeakedRoutesSpec`), and
record killed/survived in `mutation-evidence.md` ("Editor-grant audit" table):
`PatchSetResolverSupport.authorizeEditorOnDashboard` (Viewer -> Forbidden), `PatchSetApplyResolvers.resolveDashboardUpdate`
(Viewer -> Forbidden), `PipelineService.requireEditorAccess`, `PipelineRunService` (~:196), `PipelineAnalyzeReads`
(~:143), `PipelineRunPreview` (~:247), `AutoRunTriggerService` (~:144), `ApiTokenService` (~:101),
`OutputService` (~:140), `DashboardService` (~:202, ~:254), `DashboardContentsService` (~:148), `PanelService`
(~:144, ~:221, ~:279, ~:317), `AutoLayoutService` (~:143). Also the two role-mapping sites in `api/http` that every
dashboard/`requireAccess` branch above depends on (design gate 1 CR1): `AccessCheckerImpl.scala` (`Role.Viewer ->
ResourceAccess.Viewer`, `Role.Editor -> ResourceAccess.Editor`, the public-viewer arm) and `AclDirective.scala` (its
role arms). Mutation for those: map `Role.Viewer` to `Editor` (viewer let through) and `Role.Editor` to `Viewer`
(editor rejected). (Re-derive the full list by grep over `backend/src/main/scala` (not just `services`) for
`findGrantRole`, `Some("editor")`, `.contains("editor")`, `ResourceAccess.Viewer`, `ResourceAccess.Editor`,
`Role.Viewer`, `Role.Editor`; the line numbers are hints. Any hit not mutated gets a one-line reason in the table.)
`AccessCheckerImpl`/`AclDirective` are outside `services/patchsets/`, so survivors there go to the follow-up list,
unless a patch-set dashboard-branch test added here already kills them (record that).
Survivors on the two patch-set branches get tests in this change (same D1 rule, added to
`PatchSetPipelineStepGrantSpec` or a sibling patch-set spec). Survivors outside `services/patchsets/` are NOT tested
here: list them, and the orchestrator files one follow-up ticket for them (scope control; this ticket's AC is the
patch-set resolvers). If a survivor's code reading suggests a real authorization bug (not just missing coverage),
escalate per D2.

**D4 - Items 5-6: message tests.** Added to the D2 spec file or a sibling `PatchSetResolverMessagesSpec.scala`
(executor's choice; any new file uses `VerifiedEmbeddedPostgres.start` if it needs a DB, or none if the service can
be driven without one). Assert the full `ServiceError.BadRequest` message text:
- `requireTargetId`: an update edit with no `target.id` (and one with a blank `"  "` id) ->
  `edit <i>: target.id is required for op 'update'`; use a non-zero index (second edit) so the index interpolation is
  pinned too. Mutation M5: change the message literal (e.g. drop `for op '...'`) or return `Conflict` - test RED.
- `decodeCreatePatch` missing patch: a create edit with no `patch` -> `edit <i>: patch is required for a create edit`.
  Mutation M6a: message/status change - RED.
- `decodeCreatePatch` wrong shape: a create edit whose `patch` does not decode (e.g. `dashboard` create with `name` as
  a number) -> message starts with `edit <i>: patch does not match the expected shape (` . Mutation M6b - RED.
If the protocol layer rejects any of these inputs before the resolver is reached (so the resolver message is
unreachable through apply), test at the deepest reachable entry point and record that fact; do not loosen.

**D5 - Item 4: output rows.** Change `sites` on exactly the four `patch-set apply|preview: output update|delete` rows to
`Set("PatchSetOutputResolvers.scala")`; no other field or row (panel/step rows stay - see Context). Update the
spec's nearby comment if it names the old file for outputs. Proof: mutation M4 lets a foreign id through
`findOwnedOutput` (`case Some(output) if output.ownerId != user.id => Left(NotFound(...))` -> `Right(output)`), run
`ExistenceNotLeakedRoutesSpec`, show all four output rows RED for the foreign-vs-absent reason, revert, GREEN.
Also show the completeness guard still passes with the repointed rows (it is part of the same spec run).

**D6 - Items 1-3: citations; items 8-9 decisions.**
- Ticket-listed sites: `PatchSetPreviewProjection.scala` (`PatchSetApplyResolvers.pipelineSummaryResponse`),
  `PatchSetUndoService.scala` (~245), `RefinementEditShapeSpec.scala` (:31 and the :234 mention - check whether it
  names a moved member), `PatchSetPreviewServiceSpec.scala` (~504): repoint to `<NewObject>.<member>` (verify each
  member's current home by grep). `PipelineProtocol.scala` ~60: replace the nonexistent
  `PipelineService.resolveInlineOrExistingRoot` with the real member that enforces the inline-vs-existing mutual
  exclusion (find it by grep; if none clearly matches, describe the rule without a member name).
- Sweep: every comment in `backend/src` citing `PatchSetApplyResolvers.<member>` for a member that moved; and inside
  the six resolver files, every `above`/`below`/`[[...]]` hit and every `PipelineService.<member>` citation. Rule for
  `PipelineService.<member>`: a member that is still a public delegation on `PipelineService` (e.g. `updateStep`,
  `addStep`, `create`) is a correct citation and is kept (HEL-1480's convention); one that is not a member of
  `PipelineService` (e.g. `resolveRootDataSources`, if so) is repointed to the collaborator. Symbol + file, never a
  line number. Every hit with verdict (kept/fixed) in `citation-sweep.md` in the change dir.
- Grep must also catch (design gate 1 notes): citations split across a line break (e.g.
  `PatchSetUndoService.scala` ~245-246), and mentions crediting moved behaviour to `PatchSetApplyResolvers` by object
  name alone (e.g. `PatchSetProtocol.scala` ~91). A test NAME string that mentions the object (e.g.
  `PatchSetProtocolSpec` ~332) is a string literal and is fenced (test names are test identity; renaming changes
  per-suite test identity) - record it as fenced. `PatchSetApplyResolvers`'s own object doc (~13-24) is stale
  (it describes all resolvers living there) and is in scope.
- `PatchSetPreviewServiceSpec` ~500 heads its block "kept verbatim for provenance": annotate the stale member
  reference in place (e.g. add `(now PatchSetPipelineStepResolvers)`) rather than rewrite the quoted text; record.
- Fence: comment text only. No string literal, identifier or code token changes (C1). No change to
  `PatchSetApplyResolvers.scala` other than comments.
- Item 8: keep `PatchSetPipelineStepResolvers.scala` unsplit (HEL-1479's design accepted 264 lines; a split is a
  byte-move needing its own move proof, and would mix moves with this change's test/comment edits). Comment edits may
  change its line count slightly; that is fine.
- Item 9: do not edit HEL-1479's archived `move-check/` scripts. Archived evidence records what was run; rewriting it
  after merge breaks that. Both nits are noted in this design for anyone who reuses the scripts.

**D7 - Gates.** `nice -n 19 sbt -batch -J-Xmx3g` (no sbt server left running); `free -g` available >= ~15 GB before
each heavy run and before commit (three lanes share the machine); output must show the `[hel1468-guard]` line.
Targeted spec runs during red/green; one final `testFull` green, with per-suite counts for touched suites versus base
recorded in `test-count-evidence.md` (new tests are the only increase). `npm run check:scala-quality` passes. No
inline FQNs. `git diff -- backend/src/main` contains comment lines only (verify with a diff filter, record).

## Risks / Trade-offs

- D2's tests may expose that the patch-set step gate disagrees with the REST step rule. That is the point of the
  priority item; the response is escalation, not a fix.
- D3 is an audit with targeted spec runs, not full `testFull` per mutation: a mutation surviving the selected specs
  might be killed by an unselected one. Mitigation: for each survivor, one `testFull` confirmation before it is
  reported as a gap.
