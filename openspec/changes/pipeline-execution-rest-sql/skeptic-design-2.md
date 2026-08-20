## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Confirmed no implementation exists yet in this worktree (`git status --short` shows only the
  untracked `openspec/changes/pipeline-execution-rest-sql/` dir; `git diff main...HEAD --stat` is
  empty) — this is purely the design gate, no code drift to account for.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/pipeline-run-execution/spec.md`, `specs/pipeline-proposal-apply/spec.md`) fresh, in full.
- Verified round 1's three required revisions are actually resolved against ground truth:
  1. **D1 row-conversion fix** — read `PipelineRowJson.scala` in full; the new `jsRowToRow` helper
     design.md/tasks.md 1.2 specify (`case JsObject(fields) => fields.map { case (k, fv) => k ->
     jsValueToAny(fv) }`) type-checks correctly (`fields: Map[String, JsValue]` → `.map` yields
     `Map[String, Any]` = `Row`), mirrors `parseStaticRows`'s existing per-field pattern exactly, and
     the `case other => Map("value" -> jsValueToAny(other))` fallback is justified by
     `RestApiConnector.toRows`'s real `case other => Vector(other)` branch (confirmed at
     `RestApiConnector.scala:60-64`) and `SqlConnector.toRows`'s real always-`JsObject` behavior
     (confirmed at `SqlConnector.scala:126-127`, `rows.map(row => JsObject(row)).toVector`). Fixed.
  2. **`PipelineApplyProposalRollbackSpec.scala`** — confirmed lines 29-57 and 118-145 are exactly the
     two tests round 1 named, both now listed in design.md's Impact section and tasks.md 4.5 with the
     correct target assertions. Further verified this fix is actually *realizable*, not just stated:
     `PipelineApplyProposalSpecBase.scala:136` constructs `routes` via the real `new ApiRoutes(...)`
     constructor and already passes its `stubConnector` (line 66, an `Option[RestApiConfig => Future[...]]`-
     overridable `RestApiConnector`) into `ApiRoutes`'s `connector` parameter — so once task 3.1 threads
     that same `connector` into `PipelineRunService`'s construction, these two tests' `RestSuccessUrl`
     fetches will genuinely succeed end-to-end with zero further test-file changes. Fixed correctly.
  3. **`PipelineRunRoutesSpec.scala`** (the one preview test at 377-387) — now named in design.md's
     Impact section and tasks.md 4.6. Partially fixed — see Change Request #2 below: the chosen target
     outcome (200 OK) is not actually reachable given the rest of the design as specified.
- Independently re-verified design.md's other ground-truth citations against current code:
  `PipelineRunService.scala:166-172`/`200-205` (rejection blocks, still match), `SparkUnsupportedKinds`
  at `PipelineRunService.scala:710` and its two reference sites (`PipelineProposalService.scala:337`,
  doc comment at line 44), `ApiRoutes.scala:203-207`'s `new PipelineRunService(...)` construction site
  (confirmed the exact positional-arg list D3/task 3.1 describes, ending `alertEvaluationServiceOpt.orNull`
  — a new trailing `connector` param is a safe, non-breaking addition here).
- Grepped every `new PipelineRunService(`/`new InProcessPipelineEngine(` construction site across
  `backend/src/test/` (13 test files split 8/5, no overlap) — confirmed D3's "8 existing test files"
  claim is accurate, and that the only one of those 8 whose *existing* tests actually exercise
  `rest_api`/`sql` execution is `PipelineRunRoutesSpec.scala`.
- Went beyond round 1's grep (`"Unsupported source type\|SparkUnsupportedKinds\|recordUnrunnable\|
  blockedReason"`, which only catches tests asserting on response *message* text) and read
  `PipelineRunRoutesSpec.scala` end to end for any test that seeds a `rest_api`/`sql` source and
  asserts on *status code alone* — found two more pre-existing tests the revision missed (Change
  Request #1). Also confirmed by reading `PipelineRunServiceSpec.scala`, `InProcessPipelineEngineSpec.scala`,
  `PipelineApplyProposalSpec.scala`, and `ApiRoutesSpec.scala` for the same pattern (`seedDs("rest_api")`/
  `seedDs("sql")` equivalents, or literal `"rest_api"`/`"sql"` source-kind assertions tied to pipeline
  *execution* rather than source creation/validation) — no further omissions found in those files.
- Traced the exact failure mode for a null/unwired connector: `PipelineRunService.scala:388-411`
  (`runFuture.transformWith { case Failure(ex) => ... }`) and `:233-236`
  (`.recover { case ex => ... Left(ServiceError.UnprocessableEntity("Pipeline execution failed")) }`)
  both catch *any* exception (including a synchronous `throw` from inside a `.flatMap`-nested
  `loadRows` case arm — Scala's Future combinators convert that to a failed Future automatically) and
  convert it into a clean `422`/`"Pipeline execution failed"`. This is what grounds both change
  requests below: a null-connector guard failure and a real "200 OK" success are both technically
  possible outcomes of running this code, but they are *not the same outcome*, and the design/tasks
  currently assert the wrong one is reachable for the specific fixture in question.
- Confirmed `seedDs("rest_api")`/`seedDs("sql")` (`PipelineRunRoutesSpec.scala:97-99`) seed a
  degenerate `config = "{}"` for any kind other than `static`/`csv`, and that `makeRoutes`
  (`PipelineRunRoutesSpec.scala:180-198`) never accepts or constructs a `RestApiConnector` — its one
  `new PipelineRunService(...)` call is fully positional with no connector argument, so post-change it
  will default to `connector = null` per D3.

### Verdict: REFUTE

### Change Requests

1. **Two more pre-existing tests in `PipelineRunRoutesSpec.scala` assert the exact rejection this
   change removes, via the full-run route (not just the preview route already fixed in round 2), and
   neither design.md's Impact section nor tasks.md names them.**
   `PipelineRunRoutesSpec.scala:221-227` (`"POST /pipelines/:id/run returns 422 for rest_api source
   type"`) and `:229-235` (`"POST /pipelines/:id/run returns 422 for sql source type"`) each seed a
   bare `rest_api`/`sql` `DataSource` (`seedDs("rest_api")`/`seedDs("sql")`, config `"{}"`) and assert
   only `status shouldBe StatusCodes.UnprocessableEntity` on `POST /pipelines/:id/run`. Task 2.2
   deletes the code path that made this assertion true for the reason the test name claims
   ("rest_api/sql source type" is categorically unsupported). Because `makeRoutes` never threads a
   connector (defaults to `null` per D3) and the seeded config has no `url`, these two tests will
   *coincidentally* still return `422` post-change — but via the unrelated null-connector-guard path
   (or, once a connector is wired, an empty-URL fetch failure), not because the source kind is
   rejected. The assertions will keep passing, silently testing something other than what their names
   claim — exactly the kind of stale/misleading test round 1's finding #3 already flagged for the
   sibling preview test in this same file. **Required revision**: add these two tests to design.md's
   Impact section and tasks.md Section 4 (alongside 4.6), and specify their new target: either rename
   them to describe what they actually now verify (a connector-not-configured/empty-URL run failure),
   or — consistent with Change Request #2 below — seed a real reachable target and assert `200 OK`
   with populated rows, matching the new `pipeline-run-execution` spec's "A healthy rest_api source
   completes a real run" scenario.

2. **Task 4.6's chosen resolution for the existing preview test (assert `200 OK`) is not reachable
   given the rest of the design as currently specified — the design still asserts an infeasible
   outcome, just for a different existing test than round 1 flagged the same file for.** Tasks.md 4.6:
   "a `rest_api` base source's preview should now succeed (`200 OK`), not `422` with 'Unsupported
   source type'." But `PipelineRunRoutesSpec.scala`'s `makeRoutes` helper (lines 180-198) has no
   `connector` parameter and its one `PipelineRunService` construction site never passes one — per
   design.md D3, that means `connector` defaults to `null` there. D3's own null-connector guard throws
   `IllegalArgumentException` for exactly this case, which `previewStep`'s existing `.recover` block
   (`PipelineRunService.scala:233-236`) converts to `422 Unprocessable Entity` /
   `"Pipeline execution failed"` — not `200 OK`. Even setting the null-connector issue aside,
   `seedDs("rest_api")`'s config is the degenerate `"{}"` (no `url` field) — a real connector fetching
   against `RestApiConfig(url = "")` would also fail, not succeed. Compare to how round 2's fix for
   round 1's finding #2 *is* realizable: `PipelineApplyProposalSpecBase.scala:66` already builds a
   `stubConnector` (an overridable `RestApiConnector`) and threads it through the real `ApiRoutes`
   constructor (`:136-141`) into (post-task-3.1) `PipelineRunService` — no gap there. `PipelineRunRoutesSpec.scala`
   has no equivalent mechanism today, and neither design.md's Impact section nor tasks.md 4.6
   describes adding one. As written, an implementer following tasks.md literally would either produce
   a test that fails (asserts `200` but observes `422`), or have to invent — unguided — a new stub
   `RestApiConnector`, a new `connector` parameter on `makeRoutes`, and a `url`-bearing seeded config,
   none of which appear anywhere in the plan. **Required revision**: tasks.md 4.6 (and design.md's
   Impact entry for this file) must explicitly say how the test obtains a working connector — e.g.
   "add a `stubConnector` to `PipelineRunRoutesSpec.scala` mirroring
   `PipelineApplyProposalSpecBase.scala:66`'s pattern, add a `connector` parameter to `makeRoutes`
   defaulting to it, and change `seedDs("rest_api")`'s config for this test to a real `url`" — or,
   if that's out of scope for this file, fall back to asserting the null-connector-guard's actual `422`
   message instead of `200 OK` and rename the test accordingly. This is the same class of gap round 1
   raised for this exact file/scenario; the round-2 revision picked a target outcome without closing
   the loop on how it's reached.

### Non-blocking notes

- D2's `maxRunRows = 1000` bound, D4's `SparkUnsupportedKinds` becoming `Set.empty` (not deleted), D5's
  "no re-validation of `SqlSource.config.query`" precedent, and D6's stale-comment cleanup all check out
  exactly against current code; no issues there on this pass.
- Once Change Requests #1/#2 are resolved, consider whether the *new* tests task 4.6 (and any renamed
  tests from #1) writes should also cover the `sql` preview/run path the same way, for parity with the
  `rest_api` case — `SqlConnector` has no override-function test-double mechanism (it's a real
  `DriverManager`-backed `object`), so a `sql` success-path test in this particular file may need a
  different strategy (e.g. an embedded-Postgres-backed source, following the pattern already used
  elsewhere in this suite) rather than a stub; worth deciding explicitly rather than leaving `sql`
  untested here while `rest_api` gets full coverage.
