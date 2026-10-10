## Context

See proposal.md. Base is origin/main 6d298d5f8 (HEL-1463 merged). Evidence for every item is in
`openspec/changes/archive/2026-10-10-split-pipeline-service/` (mutation-evidence.md "Run 1" for the four gaps,
tasks.md 3.6 for the rest). Paths below are relative to `backend/`. Main package
`src/main/scala/com/helio/services/pipelines/` is abbreviated `pipelines/`.

Facts checked while planning (re-verify; they are claims):
- Gap sites: `pipelines/PipelineCreateWrites.scala` `create` (`req.name.trim.isEmpty` -> `BadRequest("name is required")`);
  `pipelines/PipelineNodeReads.scala` `laneTree` (`findByIdShared` None -> `NotFound`);
  `pipelines/PipelineProposalAnalyze.scala` inline `DataSourceKind.Dataset` with `staticConfig = None` ->
  `BadRequest("inline 'static' source requires a 'config' object")`;
  `pipelines/PipelineStepWrites.scala` `updateStep`, `updateInternal(...)` returning `None` -> `NotFound`.
- (Corrected at design gate 1.) No route-layer check rejects a blank pipeline name (`RequestValidation`'s
  `name is required` is for API tokens); `POST /api/pipelines` reaches the service check directly. Gap 1 is simply
  unasserted. G1 therefore gets BOTH a service-level assertion and a route-level `POST /api/pipelines` assertion.
- `PipelineStepRepository` is a non-final class with a public `updateInternal`, so a test-local subclass can force the
  "no row after update" outcome deterministically.
- `ExistenceNotLeakedRoutesSpec.Row.sites` is read in one place only: the completeness guard comparing it with
  `filesCallingAccessHelpers()` (files calling `requireOwnerOnly`/`requireAccess`/`authorizeResource*`). None of the
  pipeline collaborators call those helpers; they gate through `findByIdShared`/`findByIdOwned`. So for these rows,
  `sites` is documentation, and the property "the row fails when the producer is mutated" comes from the row's own
  foreign-vs-absent HTTP probe. Correction to the ticket: of rows 452-455, only `GET pipeline analyze` moved
  (to `PipelineAnalyzeReads.scala`); `findSummaryById`, `updateName`, `delete` stayed in `PipelineService.scala`.

## Goals / Non-Goals

Goals: the four gaps asserted with proven-failable tests; every listed stale citation correct; dead members gone;
an explicit item-4 decision. Non-goals: any behaviour change; HEL-1479's rows/file split; splitting files.

## Decisions

**D1 — Gap tests, red-first by mutation.** The code under test is already correct, so "red first" means: apply a
one-line mutation to the exact guarded branch, run the new test and show it RED with an attributable message, revert,
show it GREEN. Mutation per gap (status change, same shape as HEL-1463's run 1):
- G1 `PipelineCreateWrites.create`: blank-name `BadRequest` -> `Conflict`. Tests: (a) service-level `create` with
  name `"   "` (and otherwise valid roots) returns `Left(ServiceError.BadRequest(...))` with message
  `name is required`, and no pipeline row is written for the caller; (b) route-level `POST /api/pipelines` with a
  blank name returns `400` with that message (in or next to the existing pipeline routes spec). Both red under the
  one mutation.
- G2 `PipelineNodeReads.laneTree`: `NotFound` -> `Conflict`. Test: `laneTree` on a random `PipelineId` returns
  `Left(ServiceError.NotFound(_))`; and on a real pipeline owned by another user (no grant) returns the same
  `NotFound` (same message modulo the id). Through `PipelineService.laneTree` (the public delegation).
- G3 `PipelineProposalAnalyze`: missing-static-config `BadRequest` -> `Conflict`. Test at the route
  (`POST` analyze-proposal, in or next to `PipelineAnalyzeProposalRoutesSpec`) if a static inline source without
  `config` decodes to `staticConfig = None` there; otherwise service-level `analyzeProposal`. Assert `400` and the
  message text.
- G4 `PipelineStepWrites.updateStep`, BOTH the `config = None` branch's and the `config = Some(...)` branch's
  (~:129) update-returned-`None` arm: `NotFound` -> `Conflict`, one mutation and one test per branch. Test: a test-local
  `PipelineStepRepository` subclass whose `updateInternal` returns `Future.successful(None)` (or deletes the row then
  delegates), wired into a real `PipelineService` over embedded Postgres; owner `updateStep` with no config returns
  `Left(ServiceError.NotFound(...))`, and no `pipeline.step.update` audit is written if the spec can observe audits.
Placement: add to the nearest existing spec with matching setup where one exists; any NEW spec file uses
`VerifiedEmbeddedPostgres.start`. Mutations are applied and reverted by a small script kept in the run evidence dir
(`.concertino/runs/HEL-1480/evidence/` in the main checkout), never committed. If a gap test exposes a real defect
(the asserted behaviour is NOT what the code does), stop: record it, file a follow-up via the orchestrator, do not fix.

**D2 — Citations.** Replace every stale citation with symbol + file, never a new line number (line numbers are what
went stale, and several were already stale before HEL-1463). Ticket-listed sites with their verified targets:
- `PipelineCreateTransactionalSpec` :95 `validateStepCrossOwnerRefs (PipelineService.scala)` ->
  `PipelineCreateTransaction.validateStepCrossOwnerRefs`; :170 `PipelineService.scala:521` -> the create path's
  `PipelineStepKind.All` check in `PipelineCreatePreflight.checkStep` (and `addStep`'s in
  `PipelineStepCreate.addStepReporting`).
- `services/patchsets/PatchSetApplyResolvers.scala:178` `PipelineService.scala:568-597` -> the
  `PipelineStepWrites.updateStep` config branch and `PipelineStepCreate.addStepReporting`. This is the ONLY edit to
  that file (HEL-1479 is byte-moving it); other stale references inside `PatchSetApplyResolvers.scala` are listed in
  `citation-sweep.md` as a follow-up for after HEL-1479, not edited here.
- `services/patchsets/PatchSetPreviewProjection.scala:286` `PipelineService.scala:154-155` -> `PipelineService.updateName`.
- `infrastructure/persistence/pipelines/PipelineStepRepository.scala` ~:1092 (`PipelineService.scala` as a `trunkOf`
  caller) -> the collaborator(s) that call it (verify by grep).
Widened sweep (design gate 1 CR5): every COMMENT in `backend/src` (main and test) that cites `PipelineService.<member>`
or `PipelineService.scala` (with or without a line number, e.g. `OutputRepository.scala:75` `(:617)`) for a member
that HEL-1463 moved to a collaborator is repointed at `<Collaborator>.<member>`. Citations of members that stayed in
`PipelineService` (public delegations, companion object, `requireEditorAccess`, `updateName`, `delete`,
`findSummaryById`, `listSummaries`, `listSteps`) are correct and kept. Fences: string literals and any non-comment
code are never edited (e.g. the runtime exception strings in `PipelineServiceSupport.scala` ~:147/:173/:179; C1);
`PatchSetApplyResolvers.scala` beyond :178 (above). Positional/link sweep: in the eleven files HEL-1463 created or
reduced (`PipelineService.scala`, `PipelineServiceSupport.scala`, `PipelineAnalyzeReads.scala`,
`PipelineCreatePreflight.scala`, `PipelineCreateTransaction.scala`, `PipelineCreateWrites.scala`,
`PipelineNodeReads.scala`, `PipelineProposalAnalyze.scala`, `PipelineRootWrites.scala`, `PipelineStepCreate.scala`,
`PipelineStepWrites.scala`), grep `above|below|\[\[`; for each hit decide whether the referent is still in the same
file in the stated direction; fix only stale ones. Record every hit of both sweeps with verdict (kept/fixed/fenced/
deferred) in `citation-sweep.md` in the change dir. Verification grep: `grep -rnE "PipelineService\.scala:?[0-9(]|\(:[0-9]+\)" backend/src`
reviewed hit by hit, with each surviving hit justified in `citation-sweep.md`.

**D3 — ExistenceNotLeakedRoutesSpec rows.** Change `sites` only (no other field, no other row):
`PATCH pipeline step`, `DELETE pipeline step`, `POST pipeline step duplicate` -> `Set("PipelineStepWrites.scala")`;
`GET pipeline analyze` -> `Set("PipelineAnalyzeReads.scala")`; `GET/PATCH/DELETE pipeline` stay
`Set("PipelineService.scala")` (verify their access check still runs there). Update the spec's scaladoc if it
mentions the old site. Proof the guarantee holds: for each repointed row, mutate that collaborator's gate so foreign
and absent differ, run the spec, show that row RED, revert, GREEN. The mutation must actually separate the two probes:
for the step rows, the foreign arm (`findByIdShared` None after a found step) is distinct from the absent arm
(step not found), so changing the foreign arm's message suffices. For `GET pipeline analyze` it does NOT: one
`case _ => NotFound` arm serves both probes, so a message change is invisible. Its mutation must let a foreign id
past the gate (e.g. swap `findSummaryByIdShared`/`findByIdShared` for unscoped/internal lookups) so the foreign
probe gets a non-404; confirm the row fails for that reason. Record in `mutation-evidence.md`. Do not touch any `PatchSetApplyResolvers.scala`
row, `patchKindExemptions`, or `expectedForbiddenProducers`.

**D4 — Dead code.** Delete `PipelineServiceSupport`'s `private def stepAddress` and `PipelineService`'s class-level
`private val log` (the companion object's own `log` stays; keep the `LoggerFactory` import if the object still uses
it). Proof: compile clean with no new warnings; `javap -public` of `PipelineService`, `PipelineService$`,
`PipelineServiceSupport` before/after identical (record the diff, empty). Logger names for every log call unchanged
(no log call is touched).

**D5 — Soft budget (item 4): keep all five files, no split in this PR.** (Reasons corrected at design gate 1; the
earlier "one method" claims were false: `PipelineProposalAnalyze` has 9 members, `PipelineStepCreate` 2 incl.
`persistNewStep` ~165 lines, `PipelineCreateTransaction` 7, `PipelineAnalyzeReads` 6.) Grounds: (1) the ~250-line
budget is a soft guideline and the ticket marks item 4 informational; the overruns are 9-44%. (2) Each file is one
concern from HEL-1463's D2 decomposition, reviewed and confirmed there; a further split would re-litigate those
boundaries for size alone. (3) A byte-move split must carry HEL-1463's full proof (move checker, `javap -public`,
per-suite `testFull` identity) and an empty test diff; this PR's purpose is new tests and comment edits, so mixing a
move into it loses the "moves vs edits" reviewability that standard exists for. If a split is wanted, it is its own
behaviour-preserving ticket; the final report lists it as an optional follow-up.

**D6 — Gates.** `sbt -batch -J-Xmx3g` (no server left running), `nice -n 19`; check `free -g` available >= ~15 GB
before each heavy run; one `testFull` at a time across lanes; output must show the `[hel1468-guard]` line. Final
`testFull` green; record per-suite counts versus base for every touched suite (new tests are the only increase).
`npm run check:scala-quality` passes. No inline FQNs in new code.

## Risks / Trade-offs

- Textual conflict with HEL-1479 on one comment line in `PatchSetApplyResolvers.scala` and on adjacent rows of
  `ExistenceNotLeakedRoutesSpec`; second merger re-syncs with origin/main and re-runs the spec.
- G4 uses a repo subclass: it proves the service's handling of a `None`, not that a real race produces one. That is
  the branch the gap names.
