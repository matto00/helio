## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Ground-truth check of design.md's codebase claims (all confirmed accurate):**
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala`: `onDryRunSuccess`/
  `onRunSuccess` are threaded `assertionResults: Vector[AssertionResult]` exactly where design.md
  claims (`executeRun`'s dispatch at lines 330-331; `onRunSuccess`'s body spans exactly lines
  375-436 as stated).
- `PipelineRunRegistry.scala:23`: `TerminalStatuses: Set[String] = Set("succeeded", "failed",
  "dry_run")` — matches design's Decision 1 claim verbatim.
- `V22__pipelines.sql:6`: `last_run_status TEXT CHECK (... IN ('succeeded', 'failed'))` — confirms
  reusing `"failed"` needs no migration there, as claimed.
- `PipelineRunRepository.updateRunTerminal`/`PipelineRepository.updateLastRun` signatures match the
  exact call shapes tasks.md/design.md describe (`rowCount: Option[Int]`/`Option[Long]`,
  `errorLog: Option[String]` only on the run-level call).
- `AssertStep.scala`: `evaluateRules` maps every rule non-short-circuiting
  (`rules.map(evaluateRule)`), `SupportedSeverities = Vector("warn", "error")` — confirms the
  spec.md scenario "one error-severity rule fails while others (passing/warn) were also evaluated"
  is representable, and confirms `severity == "error"` string comparison in design's filter is safe
  (no third value exists).
- `AlertEvaluationService.evaluateForDataType(dataTypeId, rows, triggeringRunId)` takes `rows`
  directly (not a re-fetch of persisted DataType state), and in the unblocked path runs
  sequentially *after* `rowsUpsert` inside the `for` comprehension (line 427-434) — confirms
  Decision 4's technical premise: on today's happy path, alert evaluation already runs against
  data that is, by the time it runs, the DataType's current persisted state. Skipping it on a
  blocked run (where that write never happens) is therefore necessary for consistency, not
  optional polish — evaluating it anyway would fire alerts against values nobody can see on any
  dashboard. This decision survives the direct scrutiny the design doc asked for.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx:125-126` already renders
  `Failed: ${displayErrorLog}` for `status === "failed"`, and `RunStatus`/`PipelineRunRecord.status`
  frontend types already include `"failed"` — confirms the "no frontend changes" claim and that
  AC3 (discoverable via `errorLog`) will render correctly through the existing SSE path with zero
  frontend work.
- `git log`: worktree HEAD (`af9056ae`, "HEL-509 ...") is exactly `main`'s HEAD at branch point —
  confirms this design was authored against the actual current, merged 419-B code, not a stale
  mental model.
- Traced all 5 ACs in ticket.md to specific design.md decisions + tasks.md items; all are covered.
  `sbt test`/no-FQNs criteria are enforced by existing repo-wide tooling
  (`npm run check:scala-quality`), not something this design needs to re-derive.
- Mockito (`org.mockito % mockito-core`) is already a test dependency used elsewhere in this repo,
  so tasks.md's plan to verify "does NOT call ... evaluateForDataType" is achievable even though
  the existing `PipelineRunServiceSpec` fixture style favors real-DB-state assertions over mocks.

**Missing contract updates (the actual finding — see Change Requests):**
- Read `openspec/specs/pipeline-run-execution/spec.md` and `openspec/specs/pipeline-run-sse/spec.md`
  (the pre-existing, canonical capability specs `PipelineRunService`/SSE publishing already answer
  to) end-to-end. Both contain requirements/scenarios that this design's own stated behavior
  directly invalidates (see below) — yet `proposal.md`'s "Modified Capabilities" section says
  "(none)".

### Verdict: REFUTE

The code-level plan (branch structure, decisions 1/2/3/5/6, and Decision 4 under direct scrutiny)
is sound and unusually well-grounded in the real codebase — nearly every line-number/signature
claim in design.md checked out exactly against the current files. The blocking problem is not the
implementation plan; it's that this change silently invalidates existing, explicit requirements of
two *other* capabilities without a planned spec delta, which `proposal.md` explicitly (and
incorrectly) claims doesn't happen.

### Change Requests

1. **`openspec/specs/pipeline-run-execution/spec.md` needs a MODIFIED delta; proposal.md's
   "Modified Capabilities: (none)" is factually wrong.** That capability's existing spec states,
   unconditionally: "Requirement: Successful non-dry run writes schema snapshot to Type Registry —
   *After a successful non-dry run the backend SHALL update the output DataType record*..." with
   scenario "Successful non-dry run creates a succeeded pipeline_runs record — WHEN
   `POST /api/pipelines/:id/run` is called without `?dry=true` and execution succeeds THEN a
   `pipeline_runs` row exists with `status = "succeeded"`...". Under this design, a run whose step
   execution completes without exception (i.e. "succeeds" in every sense that spec currently uses
   the word) but is blocked by an error-severity assertion will *not* update the DataType record and
   will *not* get `status = "succeeded"`. That is a direct contradiction of an existing, explicit
   scenario, not an unrelated addition. Required: add
   `openspec/changes/assertion-fail-policy/specs/pipeline-run-execution/spec.md` with a
   `## MODIFIED Requirements` section carving out the blocked-run exception from both the schema-
   write requirement and the "persists a pipeline_runs record" requirement, and correct
   `proposal.md`'s Modified Capabilities list.

2. **`openspec/specs/pipeline-run-sse/spec.md` needs the same treatment.** Its "Scenario: Succeeded
   event carries row count" states: "WHEN a non-dry run completes successfully with N result rows
   THEN a `succeeded` event is published with `rowCount: N`." Under this design, a blocked run
   completes successfully (no exception, N rows computed) yet publishes `failed`, not `succeeded` —
   again a direct contradiction of a currently-true scenario, not new territory. Required: add a
   `MODIFIED Requirements` delta for `pipeline-run-sse` alongside #1, amending that scenario (and
   the sibling "PipelineRunRegistry publishes status events at each run transition" requirement) to
   state the assertion-block exception explicitly.

3. **Resolve, explicitly, whether `alert-evaluation-engine`'s spec also needs a delta.** That
   capability's own Purpose states it is invoked "from pipeline-run completion." This design
   introduces a new caller-side condition — a run that completes execution but is blocked — under
   which pipeline-run completion does *not* invoke it. The existing spec doesn't make an explicit
   "invoked on every completed run" claim the way #1/#2 do, so this is more debatable than #1/#2,
   but design.md already flagged Decision 4 as worth scrutiny; the design doc should say, in one
   sentence, whether this belongs as a third MODIFIED delta or why it doesn't, rather than leaving
   it implicit via the blanket "(none)" that #1/#2 already disprove.

### Non-blocking notes

- `ticket.md`'s Flyway guidance ("next available VNN, assigned at scheduling time, main at V59") is
  now stale — the actual latest migration on this branch is `V84__pipeline_run_assertions.sql`.
  Moot under Decision 1 (no migration planned), but if a future round overturns that decision, don't
  let the implementer trust the ticket's stale number — it must re-check
  `backend/src/main/resources/db/migration/` directly.
- The blocked-run `rowCount = None` choice (buried inside Decision 3's prose rather than given its
  own numbered Decision/Risk) is reasonable but slightly under-surfaced — 419-D's future Run History
  UI will inherit this convention (no "N rows evaluated" number for a blocked run, only for a
  crash). Worth a one-line callout of its own so a future reader doesn't have to infer it.
