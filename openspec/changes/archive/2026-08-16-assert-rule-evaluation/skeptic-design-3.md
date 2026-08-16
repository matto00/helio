## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-assert-evaluation/spec.md` in full, fresh (not carried over from
  prior rounds). Read `skeptic-design-1.md` and `skeptic-design-2.md` as claims to
  verify, not facts.

- **Round 1's finding (regex null/match-semantics) — re-verified, still fixed.**
  `design.md` Decision 3 (lines 63-75) states `find()` partial match + an explicit
  `if (v == null) null else v.toString...` guard, citing `StringOpsStep.extractRegexFn`.
  I read that method directly
  (`backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala:153-171`) —
  matches the citation exactly (`Pattern.compile`, `.matcher(v.toString).find()`,
  explicit null-guard before `.toString`). `specs/.../spec.md` lines 46-50 add the
  corresponding scenario. Resolved.

- **Round 2's finding (failed-dry-run FK violation on `insertAssertions`) —
  re-verified, still fixed.** `design.md` Decision 4 (lines 95-104) now states
  explicitly: "The new `insertAssertions` call in the `Failure` branch MUST be
  nested inside that same `if (!isDry)` guard, not called unconditionally, or a
  failed dry run with prior assert-step results would attempt an FK-violating
  insert." `tasks.md` task 5.1 (lines 47-49) requires this nesting explicitly and
  cites the guard's real location. `specs/.../spec.md` lines 52-59 and 75-79 state
  the "FAILED dry run SHALL NOT attempt to persist" requirement and add the
  corresponding scenario. `tasks.md` task 6.4 (lines 63-65) adds the fourth test
  case for this combination. I independently re-read the actual code this refers
  to (`PipelineRunService.scala:284-304`) and confirmed the `if (!isDry) { ... }
  else Future.successful(())` guard is exactly where design.md says it is (line
  295). Resolved.

- **Independently re-verified the `AssertionSink` mutable-side-channel argument
  (Decision 4) against the real code, not the prior reports' restatement of it.**
  `InProcessPipelineEngine.executeWithStepCounts`
  (`domain/InProcessPipelineEngine.scala:29-44`) is a strictly sequential
  `foldLeft`/`flatMap` chain; `PipelineRunService.executeRun`
  (`services/PipelineRunService.scala:250-319`) builds `runFuture` from that chain
  and branches on `runFuture.transformWith`. Confirmed the `Failure` branch
  genuinely has no access to any partial tuple — the mutable-sink design is sound
  and required, as both prior rounds concluded.

- Confirmed `FilterStep`'s numeric-coercion precedent for `range`
  (`domain/steps/FilterStep.scala:87-99`,
  `Option(fieldVal).flatMap(v => Try(v.toString.toDouble).toOption)`) is real and
  null-safe as cited. Confirmed the RLS policy shape cited for
  `pipeline_run_assertions` (Decision 6) matches `pipeline_runs_owner`'s actual
  `EXISTS`-subquery shape (`V35__rls_owner_only_tables.sql:77-84`), and that
  `withSystemContext` is genuinely RLS-bypassing (`SET ROLE helio_privileged
  BYPASSRLS`, per `V35`'s own header comment) — relevant to the finding below.
  No placeholders/TBDs found (`grep -rniE "TODO|TBD|figure out later|to be
  determined|placeholder"` across all planning artifacts — zero real matches).

- **New finding, not raised in round 1 or round 2 — a third instance of the same
  bug class (`insertAssertions` FK-violating an unhandled `Future` failure),
  reachable via a live, real HTTP route, with zero design coverage and zero
  planned test coverage.**

  Traced the actual write-path ownership check `insertRun`/`insertDryRun` perform,
  independent of the dry-run angle rounds 1/2 already covered:
  - `PipelineRunRepository.insertRun` / `insertDryRun`
    (`infrastructure/PipelineRunRepository.scala:51-54`, `:123-126`) both gate on
    `ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user))`,
    where `pipelineOwnedAction` (`:31-34`) checks `p.ownerId === UUID.fromString(user.id.value)`
    — i.e. does the pipeline's owner literally equal the **calling** `user`. On
    `false`, both methods **silently no-op** (`case false => Future.successful(())`,
    never reaching `insertRunInternal`/`insertDryRunInternal` at all — no DB write
    is even attempted, let alone an error raised).
  - This is confirmed **existing, intentional, tested** behavior — not something I
    inferred: `PipelineRunRepositorySpec.scala:269` and `:276`, "insertRun is a
    silent no-op for a non-owner (CS2)" / "insertDryRun is a silent no-op for a
    non-owner (CS2)", both pass a non-owner `AuthenticatedUser` and assert no row
    is created.
  - **This is directly reachable for an editor grantee, not just a hypothetical
    non-owner.** `PipelineRunService.submit`
    (`services/PipelineRunService.scala:83-102`) explicitly permits editor
    grantees to trigger runs: `case Some(pipeline) if pipeline.ownerId.value !=
    user.id.value => pipelineRepo.findGrantRole(...).flatMap { case
    Some("editor") => runPipeline(pipeline, pipelineId, isDry, user, ...) ... }`
    — `runPipeline` (`:104-131`) passes that same grantee `user` (never swapped
    for the owner) into `executeRun`, whose `preExec`
    (`:266-272`) calls `pipelineRunRepo.insertRun(runId, pipelineId, startAt,
    user, ...)` with the grantee's own identity, and whose `onDryRunSuccess`
    (`:321-337`) likewise calls `insertDryRun(..., user)` with the grantee's own
    identity. **So for any editor-grantee-triggered run — dry or real — no
    `pipeline_runs` row is ever created, silently, today, with no error surfaced
    to the caller** (`updateRunTerminal`'s cross-user UPDATE in the `Failure`
    branch also silently no-ops for the same reason — it's an UPDATE matching
    zero rows, not an INSERT, so no constraint can be violated there).
  - This path is live via a real, documented HTTP route:
    `PipelineRunSubmitRoutes.scala:21-30` — `POST
    /api/pipelines/:id/run[?dry=true]` — dispatches straight to
    `runService.submit(pipelineId, isDry, user)` with whatever `user` the request
    is authenticated as. Any owner who has shared a pipeline with an editor
    grantee (an established, tested feature — `findGrantRole`, HEL-265/HEL-279)
    makes this reachable today.
  - **Consequence for this ticket's plan:** `design.md` Decision 6 states
    `insertAssertions` "always runs via `withSystemContext`" — i.e. it does
    **not** perform any ownership check and does **not** no-op for a non-owner;
    it unconditionally attempts the INSERT (`withSystemContext` uses the
    `BYPASSRLS` privileged pool, confirmed via `V35`'s own header comment — RLS
    is skipped entirely, so nothing there gates the write either). `AssertStep`
    evaluates its rules identically regardless of who triggered the run, so
    `sink.results` will be non-empty for an editor-grantee-triggered run on a
    pipeline containing an `assert` step exactly as for an owner-triggered one.
    The new `pipeline_run_assertions.run_id` FK (`REFERENCES pipeline_runs(id) ON
    DELETE CASCADE`, per task 4.2) will therefore be violated the moment
    `insertAssertions` is called for such a run — in **all four** combinations
    (successful real run, failed real run, successful dry run, and — per round
    2's already-fixed guard — failed dry runs are separately excluded, but the
    other three are not), because the parent `pipeline_runs` row genuinely never
    exists for a grantee-triggered run, success or failure.
  - Neither `design.md` nor `tasks.md` mentions this interaction anywhere — I
    grepped both plus `proposal.md`/`ticket.md`/`spec.md` for
    `grantee|non-owner|editor|recoverWith`; every existing hit is about the
    **read**-side (`listAssertionsByRun`/`listAssertionsByRunInternal` parity for
    grantee reads, per AC3) — none addresses the **write**-side interaction
    between the grantee no-op on `insertRun`/`insertDryRun` and the new
    unconditional `insertAssertions` call.
  - Unlike `insertRun`'s own `.recoverWith { case _ => Future.successful(()) }`
    (chained onto `insertRun.flatMap(_ => deleteOldRuns)`,
    `PipelineRunService.scala:271`) and `insertDryRun`'s equivalent
    (`.recoverWith { case _ => Future.successful(()) }`,
    `PipelineRunService.scala:334`), `tasks.md` task 5.1 plans **no**
    `recoverWith` around the new `insertAssertions` call — it lists only two
    guards ("Guard every call on `pipelineRunRepo != null`... and skip when
    `sink.results` is empty"), neither of which prevents the FK violation for a
    grantee-triggered run with a non-empty sink. An unrecovered failed `Future`
    from a Postgres constraint violation, at that point in `transformWith`'s
    `Success`/`Failure` arms, propagates and turns what is today a clean
    `Right(response)`/`Left(ServiceError.UnprocessableEntity(...))` result into
    an unhandled failed `Future` for a live, already-shipped, already-tested
    sharing feature — a **regression**, exactly the same failure class round 2
    caught, just triggered by a different (and broader) precondition.
  - `tasks.md` task 6.4 lists exactly four persistence-test cases (successful
    run, failed run, successful dry run, failed dry run) — none involve a
    non-owner/grantee-triggered run, so **this specific, live-reachable case has
    zero planned test coverage** and could ship with `sbt test` green, same as
    round 2's now-fixed gap did before it was caught.

### Verdict: REFUTE

Rounds 1 and 2's findings are both genuinely fixed, verified independently against
the real source rather than the prior reports' narrative. But an independent full
pass over the rest of the design surfaces a new gap of the identical class and
severity: `insertAssertions`'s unconditional, `recoverWith`-less INSERT will
FK-violate — and propagate as an unhandled `Future` failure — whenever an editor
grantee (not the pipeline owner) triggers a run, dry or real, on a pipeline
containing an `assert` step, because `insertRun`/`insertDryRun` are confirmed,
tested, existing no-ops for a non-owner `user`, leaving no parent `pipeline_runs`
row for the new child insert to reference. This is reachable today via the live
`POST /api/pipelines/:id/run` route for any pipeline shared with an editor
grantee, and neither `design.md`, `tasks.md`, nor `specs/.../spec.md` mentions it.

### Change Requests

1. **`design.md` Decision 4 and/or 6 must explicitly address the non-owner
   (grantee) write path.** State that `insertRun`/`insertDryRun` are confirmed
   silent no-ops for a non-owner `user` (`PipelineRunRepositorySpec.scala:269,276`,
   "CS2"), that this is reachable for editor grantees via `submit`'s grantee
   branch (`PipelineRunService.scala:93-98`) and the live `POST
   /api/pipelines/:id/run` route, and that `insertAssertions` — which per
   Decision 6 always runs via `withSystemContext` with no ownership gate of its
   own — must not be allowed to propagate an FK violation when no parent
   `pipeline_runs` row exists for this reason. Required fix: wrap every
   `insertAssertions` call site in `.recoverWith { case _ => Future.successful(()) }`,
   mirroring the exact defensive pattern already used by the adjacent
   `insertRun`/`deleteOldRuns` (`PipelineRunService.scala:271`) and
   `insertDryRun`/`deleteOldDryRuns` (`PipelineRunService.scala:334`) chains in
   this same file, so a missing-parent-row FK violation (or any other transient
   persistence failure) degrades gracefully — consistent with how the rest of
   this run-completion path already treats persistence as best-effort — rather
   than turning a live, already-shipped sharing feature into an unhandled
   exception.

2. **`tasks.md` task 5.1 must add this `recoverWith` wrapping as an explicit
   requirement**, not just the currently-listed `pipelineRunRepo != null` /
   `sink.results` non-empty guards, for every `insertAssertions` call site
   (`Success` branch — both `onRunSuccess` and `onDryRunSuccess` paths — and the
   already-fixed `Failure`-branch-nested-in-`if (!isDry)` call from round 2).

3. **`specs/pipeline-assert-evaluation/spec.md`'s persistence requirement should
   add a scenario for a non-owner (grantee)-triggered run**, stating that
   assertion-result persistence is best-effort and a failure to persist (for any
   reason, including no parent `pipeline_runs` row) does not fail the run's
   response — mirroring the existing "failed dry run" scenario's shape but for
   this distinct precondition.

4. **`tasks.md` task 6.4 should add a fifth persistence-test case: a run (real or
   dry, successful or failed) triggered by a non-owner editor grantee on a
   pipeline containing an `assert` step**, asserting the run still resolves with
   its normal response (no crash, no unhandled `Future` failure) even though no
   `pipeline_runs` row (and consequently no `pipeline_run_assertions` rows) is
   persisted for it — this is the only currently-live, currently-reachable
   scenario in this design with zero planned coverage.

### Non-blocking notes

- `tasks.md` 1.1's "guarded against concurrent access" still loosely cites
  Decision 4 (which is about failure-survival, not concurrency) — carried over
  from rounds 1/2's non-blocking note, still accurate, still not worth blocking
  on (the `foldLeft` is strictly sequential within one run and a fresh sink is
  constructed per run).
- Decision 3's malformed-rule catch-all still slightly under-enumerates
  `PipelineAnalyzeService.inferAssert`'s allow-list check (omits "field" from
  "kind/severity fails... allow-list check") — `field: Option[String]`'s type
  already forces an implementer to handle `None` before evaluating a
  field-requiring rule, so this remains a much smaller risk than the write-path
  gap above, not required to block on (carried over from round 2).
- This worktree's `scripts/concertino/` is still missing `next-report-number.sh`,
  `persist-evidence.sh`, and `emit-event.sh` (same gap round 2 flagged). I again
  invoked the main checkout's copies directly against this worktree's paths for
  report-numbering/persistence — pure, git-aware path-resolution scripts with no
  dependency on being physically colocated with the worktree.
