## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-assert-evaluation/spec.md` in full (fresh read, not carried
  over from round 1's report). Also read round 1's report
  (`skeptic-design-1.md`) as a claim to verify, not a fact.

- **Round 1's blocking finding (regex null/match-semantics) — independently
  re-verified against the actual precedent, not just the design doc's
  restatement of it.** `design.md` Decision 3's `regex` bullet (lines 63-75)
  now states: `find()` (partial match), and an explicit `if (v == null) null
  else v.toString...` guard before `.toString`, citing
  `StringOpsStep.extractRegexFn`. I read that method directly
  (`backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala:153-173`):
  ```scala
  row => {
    val v = row.getOrElse(field, null)
    if (v == null) null
    else {
      val matcher = compiled.matcher(v.toString)
      if (matcher.find()) matcher.group(1) else null
    }
  }
  ```
  This matches the design doc's citation exactly — partial `find()`, explicit
  null-guard before `.toString`. `specs/pipeline-assert-evaluation/spec.md`
  now has a new scenario ("regex rule fails gracefully on a null or absent
  field, without throwing", lines 46-50) exercising rows `[{"code": null},
  {}]}` against a `regex` rule. This closes round 1's gap correctly and is
  grounded in the real source, not asserted. **Round 1's finding is resolved.**

- Re-verified the `AssertionSink` mutable-side-channel argument (Decision 4)
  against the real code independently: `InProcessPipelineEngine.executeWithStepCounts`
  (`domain/InProcessPipelineEngine.scala:29-42`) is a strictly sequential
  `foldLeft`/`flatMap` chain; `PipelineRunService.executeRun`
  (`services/PipelineRunService.scala:250-319`) builds `runFuture` from that
  chain and branches on `runFuture.transformWith { case Failure(ex) => ...
  case Success(...) => ... }` — the `Failure` branch has access to `ex` only,
  confirming a purely-functional tuple extension genuinely cannot satisfy
  "persist partial results on failure." This part of the design is sound.

- **New finding, not raised in round 1 — a genuine crash/regression risk in
  the dry-run × failure intersection that design.md and tasks.md leave
  unaddressed.** Traced the actual code paths:
  - `preExec` (`PipelineRunService.scala:266-272`) only calls
    `pipelineRunRepo.insertRun(...)` `if (!isDry && pipelineRunRepo != null)`
    — **for a dry run, no `pipeline_runs` row exists before the engine runs.**
  - The `Failure(ex)` branch (`PipelineRunService.scala:284-304`) only touches
    the repository `if (!isDry) { ...updateRunTerminal...updateLastRun... }
    else Future.successful(())` — **for a failed dry run, no `pipeline_runs`
    row is ever created, before or after the failure.** This is existing,
    unchanged behavior (verified by reading the code as it stands today,
    pre-ticket).
  - `onDryRunSuccess` (`PipelineRunService.scala:321-337`) is the *only* place
    a dry run's `pipeline_runs` row gets created (`insertDryRun`), and it is
    only reached from the `Success` case (`PipelineRunService.scala:315`).
  - **Consequence:** a dry run containing an `assert` step, followed by a
    later step that throws, reaches `Failure(ex)` with `isDry = true` and
    `sink.results` non-empty (the engine doesn't special-case `isDry` at all —
    it evaluates assert steps identically for dry and real runs) — but **no
    parent `pipeline_runs` row exists to attach assertions to.**
  - `design.md` Decision 4 says results are read "in both branches of
    `runFuture.transformWith` (`Success` and `Failure`)" with no `isDry`
    qualifier. Decision 5 discusses dry-run persistence in detail but *only*
    for the success path (`onDryRunSuccess`'s ordering note) — it never
    addresses what happens when a dry run fails.
  - `tasks.md` task 5.1 says: "call `pipelineRunRepo.insertAssertions` with
    `sink.results` in both the `Success` and `Failure` branches of
    `runFuture.transformWith`... — and in `onDryRunSuccess`'s path too...
    whenever `pipelineRunRepo` is non-null... and `sink.results` is
    non-empty." Read literally, this is an unconditional call in the
    `Failure` branch, not nested inside the existing `if (!isDry) { ... }
    else Future.successful(())` guard that already sits right there for
    exactly this reason (nothing exists to update for a dry run on failure).
    An implementer following this text literally, rather than independently
    noticing the adjacent `if (!isDry)` guard and mirroring it, would call
    `insertAssertions(runId, sink.results)` for a **run id that has no
    corresponding `pipeline_runs` row**, triggering a Postgres FK violation
    on a table this ticket itself defines (`run_id → pipeline_runs(id)`).
    That failed `Future` is not currently wrapped in any `recoverWith` in
    this branch (unlike `preExec`'s `insertRun`/`deleteOldRuns` or
    `onDryRunSuccess`'s `insertDryRun`/`deleteOldDryRuns`, both of which do
    have one), so it would propagate and turn what is today a graceful
    `Left(ServiceError.UnprocessableEntity("Pipeline execution failed"))`
    response into an unhandled failed `Future` — a **regression**, not merely
    a missed feature, for a realistic and unremarkable case (a user
    dry-running a pipeline they're actively iterating on, which is exactly
    when a later step is most likely to be broken).
  - `specs/pipeline-assert-evaluation/spec.md`'s "Assertion results are
    persisted per run" requirement (lines 52-56) states persistence applies
    "whenever a pipeline containing one or more `assert` steps completes a
    run (succeeded, failed, or dry-run)" — phrasing that reads as three
    parallel terminal buckets, but doesn't resolve whether "failed" and
    "dry-run" can co-occur, nor what should happen if they do given no parent
    row exists in that combination. Its "Partial assertion results persist
    after a failed run" scenario (lines 62-66) doesn't specify real vs. dry,
    so it cannot be traced to confirm which behavior is intended.
  - `tasks.md` task 6.4 lists exactly three persistence-test cases — "a
    successful run," "a failed run (partial results...)," and "a dry run" —
    with no fourth case for a *failed* dry run, so unlike round 1's
    non-blocking dry-run-success-ordering note (which task 6.4's planned test
    would have caught automatically), **this specific combination has no
    planned test that would catch a wrong implementation**, and could ship
    with `sbt test` green.

- No placeholders/TBDs found (`grep -rniE "TODO|TBD|figure out later|to be
  determined|placeholder"` across all planning artifacts — zero real matches).

- Confirmed `AssertRule`/`AssertConfig` (`domain/steps/AssertStep.scala`) and
  `PipelineAnalyzeService.inferAssert`'s allow-list check
  (`domain/PipelineAnalyzeService.scala:455-498`, `AssertFieldRequiredKinds`/
  `AssertRuleKinds`) are real and match what Decision 3 cites — including a
  `fieldProblem` check for a field-requiring rule with a missing/unknown
  `field`, which Decision 3's malformed-rule catch-all text summarizes as
  "kind/severity fails... allow-list check" (omitting "field" from that
  enumeration, even though the cited check does include it). This is a minor
  wording imprecision, not a blocking gap on its own — `field: Option[String]`
  forces any implementer to handle the `None` case at the type level before
  they can evaluate a field-requiring rule at all, unlike the round-1 regex
  issue where an already-unwrapped `String`/`Any` value invited an unguarded
  `.toString` call with no type-level nudge to consider null. Noted below as
  non-blocking.

- Confirmed `FilterStep`'s numeric-coercion precedent for `range`
  (`domain/steps/FilterStep.scala:87-99`,
  `Option(fieldVal).flatMap(v => Try(v.toString.toDouble).toOption)`) is real
  and null-safe as cited.

### Verdict: REFUTE

Round 1's finding is genuinely fixed — the `regex` rule's null/match
semantics are now explicit, precedent-grounded, and spec-covered. But an
independent pass over the rest of the design surfaces a new gap of the same
class and severity: an unspecified interaction between "persist on `Failure`"
(Decision 4) and "a dry run's `pipeline_runs` row only exists after success"
(Decision 5) that, if implemented per `tasks.md`'s literal wording, produces
an FK-violation crash on a realistic path (dry run with an assert step,
followed by a later step that fails) with zero planned test coverage to catch
it — turning today's graceful failure response into an unhandled exception.

### Change Requests

1. **`design.md` Decision 4 and/or 5 must explicitly resolve the
   failed-dry-run case.** State that when `isDry = true` and the run reaches
   the `Failure` branch of `runFuture.transformWith`, no `pipeline_runs` row
   exists (unchanged pre-ticket behavior — `preExec` skips `insertRun` for
   dry runs, and the `Failure` branch's `failWork` is a no-op for dry runs
   today), so `insertAssertions` must **not** be called in that combination —
   `sink.results` for a failed dry run is simply not persisted (there is
   nothing to link it to). This should mirror the existing `if (!isDry) {
   ...updateRunTerminal... } else Future.successful(())` guard already
   present in that exact branch (`PipelineRunService.scala:294-304`), not
   introduce a second, differently-scoped condition.

2. **`tasks.md` task 5.1 must be revised so the `Failure`-branch
   `insertAssertions` call is explicitly nested inside the existing
   `if (!isDry)` guard**, not phrased as an unconditional call spanning "both
   the Success and Failure branches." As currently worded, a literal reading
   directs an unconditional call that will FK-violate for a failed dry run.

3. **`specs/pipeline-assert-evaluation/spec.md`'s persistence requirement
   (lines 52-56) needs its "(succeeded, failed, or dry-run)" phrasing
   clarified** so it doesn't imply "failed dry run" is a covered/expected
   case when no parent row can exist for it. Either scope the "Partial
   assertion results persist after a failed run" scenario explicitly to a
   non-dry run, or add a new scenario stating that a failed dry run does not
   attempt to persist assertion results (and does not error).

4. **`tasks.md` task 6.4 should add a fourth persistence-test case: a dry run
   containing an assert step followed by a step that fails**, asserting the
   run still resolves gracefully (no crash, matching today's
   `Left(ServiceError)` behavior) and that no orphaned/FK-violating insert is
   attempted. This is the only one of task 6.4's scenarios with zero planned
   coverage today.

### Non-blocking notes

- Decision 3's malformed-rule catch-all cites "kind/severity fails...
  allow-list check" but the actual `inferAssert` check it points to
  (`PipelineAnalyzeService.scala:471-478`) also flags a missing/unknown
  `field` for field-requiring rule kinds. Worth tightening the wording to
  "kind/severity/field" for completeness, but `field: Option[String]`'s type
  already forces an implementer to handle the `None` case before they can
  evaluate a field-requiring rule, so this is a much smaller risk than round
  1's regex gap — not required to block on.
- `tasks.md` 1.1's "guarded against concurrent access" still cites Decision 4
  loosely (Decision 4 is about failure-survival, not concurrency) — carried
  over from round 1's non-blocking note, still accurate, still not
  worth blocking on (the `foldLeft` is strictly sequential within one run and
  a fresh sink is constructed per run).
- This worktree's `scripts/concertino/` is missing `next-report-number.sh`,
  `persist-evidence.sh`, and `emit-event.sh` (present in the main checkout's
  copy, likely a stale worktree checkout predating those scripts' addition to
  the synced set). I invoked the main checkout's copies directly against this
  worktree's paths for report-numbering/persistence — they are pure,
  git-aware path-resolution scripts with no dependency on being physically
  colocated with the worktree, and this doesn't touch the worktree's git
  metadata. Flagging so the executor/orchestrator can refresh this worktree's
  `scripts/concertino/` if that becomes a live blocker in a later phase (e.g.
  `assert-phase.sh`/`start-servers.sh` are present here, so the execution/
  final-gate phases should be unaffected).
