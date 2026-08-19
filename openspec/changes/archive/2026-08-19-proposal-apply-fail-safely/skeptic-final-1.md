## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-apply/spec.md`, both `skeptic-design-*.md` rounds, and
  `evaluation-1.md` — treated all as claims, not facts, and re-derived every conclusion below from the
  actual diff/commit/tests.
- `git diff main...HEAD --stat` — 5 code files changed (`PipelineProposalService.scala`,
  `PipelineRunService.scala`, `PipelineApplyProposalRollbackSpec.scala`,
  `PipelineApplyProposalSpecBase.scala`, `PipelineRunServiceSpec.scala`) plus 10 `openspec/` planning
  files. `git diff --name-only main...HEAD` matches `files-modified.md` exactly — no scope creep.
- Read the full diff of both main-source files line by line (not summarized):
  - `handleInlineCreated` no longer deletes the source on `csr.fetchError = Some(err)`; it now threads
    `fetchError` and a new `kind` param (from its two callers, `resolveSqlSource`/`resolveRestSource`)
    onto `ResolvedSource` and always returns `Right`. Matches design D1 exactly.
  - `resolveExistingSource` populates `kind = ds.kind`; `resolveStaticSource` populates `kind =
    DataSourceKind.Static`. All three `ResolvedSource` construction sites are covered — no path leaves
    `kind` unset (it's a required field, so this is compiler-enforced, not just reviewed).
  - `createPipeline`'s new `case Right(_) if PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind)`
    guard sits correctly before the unguarded `case Right(_) =>`, skips `pipelineRunService.submit`
    entirely, and calls the new `recordUnrunnable` — building a `201 Created`
    `PipelineProposalApplyResponse` with `run.blocked = true`. Matches design D2 exactly. The reason
    string branches on `resolved.fetchError` (present → connector message + "Fix the source
    configuration..."; absent → "$kind sources aren't executed automatically yet...").
  - `PipelineRunService.recordUnrunnable` (new) mirrors the existing `onBlockedRun` persistence
    pattern: best-effort `insertRun` (`recoverWith`-guarded, matching 6+ other call sites in the same
    file that already use the identical `pipelineRunRepo != null` / `recoverWith` guard — not a novel
    anti-pattern), `updateRunTerminal(..., "failed", ..., errorLog = Some(reason), ...)`,
    `pipelineRepo.updateLastRun(..., "failed", ...)`, returns a `blocked = true` `RunResultResponse`.
    New companion `object PipelineRunService { val SparkUnsupportedKinds = Set(RestApi, Sql) }` is a
    single source of truth, doesn't touch the two existing sealed-trait match arms in
    `runPipeline`/`previewStep` that already hardcode the same set.
- `PipelineProposalApplyResponse.run: RunResultResponse` and `RunResultResponse(blocked: Boolean =
  false, blockedReason: Option[String] = None, ...)` (`PipelineProtocol.scala:97-105`,
  `PipelineProposalProtocol.scala:45-50`) — confirmed no wire-shape change, matching design D2's
  explicit "no new wire fields" decision.
- `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:38-64`) — confirmed `Left(err)` never calls
  `dataTypeRepo.insert`, so a fetch-failed inline source legitimately has no companion DataType (the
  fetch-fail test's `dataTypeCount() shouldBe (beforeTypes + 1)`, i.e. only the pipeline's own output
  type, is correct, not a miscount).
- `PipelineProposalRoutes.scala:38-39` — `ServiceResponse.run(...) { response => StatusCodes.Created ->
  response }` confirms a `Right(...)` from `apply` always serializes as `201 Created`, so the rewritten
  tests' `status shouldBe StatusCodes.Created` assertions are checking the real route, not a test double.
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx:22-41` — read directly: `StatusBadge` maps
  `lastRunStatus === "failed"` to a red `StatusChip intent="error"` "Failed" badge — independently
  confirms the design/skeptic-design-2 claim that `recordUnrunnable`'s `updateLastRun(..., "failed",
  ...)` produces a genuinely visible "needs-attention" signal with zero frontend changes, satisfying the
  ticket AC "left in a visibly misconfigured/needs-attention state."

**Fresh gate re-runs (not trusted from the evaluator's report):**
- `cd backend && sbt -batch "testOnly com.helio.api.PipelineApplyProposalRollbackSpec
  com.helio.services.PipelineRunServiceSpec com.helio.api.PipelineApplyProposalSpec"` → 39/39 passed,
  3 suites, 0 failures.
- `cd backend && sbt -batch test` (full suite) → **3284/3284 passed, 210 suites, 0 failures** — matches
  the evaluator's and the commit message's claimed counts exactly.
- `npm run check:scala-quality` → clean, 0 hard errors, 122 pre-existing soft (file-size) warnings.
- `npm run check:schemas` → clean (66 protocols / 47 files) — no wire-shape drift, confirming D2's "no
  schema change" claim.
- `npm run check:openspec` → fails for exactly the expected/sole reason ("complete (13/13) but not
  archived") — matches the commit's explicit `-n` bypass justification; nothing else fails.
- `git log -1 --format=%B` on `ec6c727c` — the `-n` bypass is explicitly called out with the verification
  evidence pasted inline, per CONTRIBUTING.md's AI-collaborator policy.

### Acceptance criteria traced

1. "Actual unsafe path root-caused to a specific line/call" — design.md Context traces it to
   `handleInlineCreated`'s delete-and-abort (pre-fix) plus the independent
   `PipelineRunService.runPipeline`/`InProcessPipelineEngine.loadRows` categorical rejection. Both are
   named with file:line references and both are fixed in the diff. Met.
2. "Never a raw 502 / unhandled exception — typed, safe JSON response" — confirmed: the route always
   returns `201 Created` with a well-typed `PipelineProposalApplyResponse` for these cases now (verified
   via route code + passing tests); no `Left(ServiceError.BadGateway(...))` construction remains anywhere
   in `PipelineProposalService.scala` for this path (`grep` shows 22 other `ServiceError.BadGateway`
   call-sites elsewhere in the codebase, none in this file post-diff). Met.
3. "Still creates what can safely be created, source left in visibly needs-attention state" — confirmed
   by both the DB-count assertions (source/pipeline retained) and the `lastRunStatus` = `"failed"` →
   red "Failed" badge trace above. Met.
4. "User ends up able to navigate to a real pipeline/source to fix" — `resp.pipeline.id`/`resp.source`
   are real, non-empty ids in the retained-resource tests; the pipeline is queryable via existing routes.
   Met.
5. "Regression coverage: apply with unreachable REST source completes successfully (source + pipeline
   created, fetchError surfaced)" — the rewritten "schema-fetch failure" test asserts exactly this,
   `201 Created`, retained counts, `blockedReason` containing the connector's message, and a persisted
   `pipeline_runs` row. Met, and extended (SQL + existing-sourceId + healthy-fetch-but-unsupported-kind
   cases) beyond the literal AC per the design's justified broadening (D2's own reasoning: the narrower
   fix alone would leave the reported incident's exact scenario — a healthy fetch still hitting the
   Spark-submission rejection — unfixed).

### Design-gate skeptic history sanity check

Both round-1 (false "ticket filed" claim, missing durable-persistence) and round-2 (CONFIRM) skeptic
findings were independently re-verified against the shipped code, not just re-read: HEL-758 exists in
Linear (not re-queried here since skeptic-design-2 already did so directly against Linear and the design
doc's citation is unchanged since), and `recordUnrunnable`'s actual implementation in the diff matches
D3's design exactly (traced above) — the round-1 gap (nothing was ever written to `pipeline_runs` for the
skip case) is genuinely closed in the shipped code, not just in the design doc.

### Verdict: CONFIRM

The unsafe path is correctly root-caused and fixed at both of its two independent causes (schema-fetch
delete-and-abort, and the unconditional Spark-submission rejection for `rest_api`/`sql`). Every acceptance
criterion traces to real, passing code. All gates re-run fresh and green, matching claimed counts exactly
(3284/3284 backend, clean lint/schema/scala-quality). No scope creep — diff matches `files-modified.md`
exactly. This is a pure backend service change with no `frontend/**` diff, so no UI/design-judgment review
applies (Phase 4/DESIGN.md N/A, consistent with the evaluator's Phase 3 N/A finding, independently
confirmed via `git diff --name-only`).

### Non-blocking notes

- Same observation the evaluator made: `PipelineProposalService.scala` (449 lines) and
  `PipelineRunService.scala` (733 lines) are both over the ~400-line soft-split threshold, pre-existing
  before this change and only modestly grown by it. Worth a follow-up ticket, not blocking here.
- The outer `describe` block in `PipelineApplyProposalRollbackSpec.scala` is still named `"POST
  /api/pipelines/apply-proposal rollback"` even though 4 of its 7 cases now assert the opposite (no
  rollback). The file-level doc comment explains this clearly, so not blocking, but a rename would read
  better on its own.
