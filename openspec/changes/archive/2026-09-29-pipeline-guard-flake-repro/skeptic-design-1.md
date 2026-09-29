## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `pwd -P` → `/home/matt/Development/helio`; `assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=bug/repro-pipeline-guard-flake/HEL-1195`.
  Proceeded normally.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md` in full from
  `openspec/changes/pipeline-guard-flake-repro/`.
- **Ground-truth check of design.md's factual claims against the actual code** (not trusting the
  narrative):
  - `PipelineRunGuardIntegrationSpec.scala`: `awaitAllSettled` at lines 180-183 (matches design.md
    Context's citation exactly); the concurrency-cap test at lines 265-303 (matches); `onAdmitted()`
    fires at line 155, strictly before `gate.map(...)` at line 156 — confirms design.md's "settled
    signalled strictly before blocking on the gate" characterization of the CURRENT code.
  - `PipelineRunService.scala` lines 1012-1029: confirmed the `deleteOldRuns` gap exactly as
    described — `insertRunIfUnderConcurrencyCap` resolves to `Inserted`/`NotOwned`, THEN
    `deleteOldRuns(pipelineId, user, keepN = 10).recoverWith{...}` runs (an extra DB round trip),
    THEN (lines 1049-1051) `backend.execute(...)` is called (where `onAdmitted()` lives). This is a
    real, concrete, previously-unexamined candidate mechanism, not fabricated.
  - `backend/build.sbt` lines 126-168: confirmed HEL-924's `Tags.ForkedTestGroup` concurrency cap
    (default 4, of 8 groups) and, critically, **`Test / fork := true`** — every forked test JVM is a
    child of the sbt driver JVM. This matters for one of my findings below.
  - Design.md's characterization of all of the above is accurate — I found no fabricated or
    exaggerated claims against the actual files.
- Checked for placeholders (`TODO`/`TBD`) across `design.md`/`tasks.md` — none found, except one
  substantive gap detailed in Change Request 1 below (an unresolved `N` that functions like an
  unstated placeholder for a load-bearing bound).
- Confirmed the `deleteOldRuns` finding is treated as a genuine unconfirmed candidate, not a baked-in
  conclusion: design.md Context says "This is a candidate mechanism only... not yet probed"; Decision
  3's H2 branch explicitly requires the repro to trace to it before claiming it ("if not, don't claim
  it"); tasks.md 3.2 requires temporary instrumentation and a trace before attributing. No defect here.
- Confirmed H1's branch (Decision 3, tasks.md 4.1, standing constraint C4) properly stops short of
  touching `insertRunIfUnderConcurrencyCap` and requires an `ESCALATION` rather than a self-approved
  production fix. No defect here.
- Confirmed AC traceability: ticket.md's three ACs (reproduce under full-suite load with evidence
  capture; identify hypothesis before any fix, red-first; if H1, reopen the guard-correctness
  question) each map to specific design.md Decisions and tasks.md sections. No scope drift found —
  proposal.md's Non-goals correctly exclude HEL-505 rate-limit/dry-run/trigger-source reopening,
  retries/sleeps, HEL-924 tuning, and the cross-owner concurrency question.

### Verdict: REFUTE

The reproduction-methodology framing (spec-under-contention as a physically-justified approximation
of full-suite contention, escalating to a real full-suite loop as fallback) is sound in principle and
is explicitly sanctioned by the ticket's own AC text ("loop the full backend suite, OR the spec
alongside a CPU/DB-contending workload"). The hypothesis-branch fix shapes are genuinely
evidence-gated (red-before/green-after, H1 stops for escalation, `deleteOldRuns` treated as candidate
not conclusion). However, two concrete gaps make the plan not yet implementable as written — both
squarely inside this design gate's job, not nitpicks:

### Change Requests

1. **`design.md` Decision 1 / `tasks.md` 1.1 — the spec-under-contention reproduction loop has no
   stated bound.** Decision 1 says "run ... in a tight loop ... repeated N times sequentially" — `N`
   is never resolved to an actual number anywhere in `design.md` or `tasks.md`, and no wall-clock
   budget is given either. Contrast this with method 2 (full-suite loop), which explicitly states "at
   most 3 sequential iterations." `tasks.md` 1.1's own Verify line ("at least one failure is observed
   within **a stated bounded iteration count**, OR the bound is reached with 0 failures") presupposes
   a bound that is never actually stated by the plan — it reads as if `N` will be filled in later by
   whoever executes it, which is exactly the "decision deferred that blocks implementation" pattern a
   design gate exists to catch. This is not academic: `tasks.md` 3.3 and Decision 3's "nothing
   reproduces" escalation branch, and standing constraint C5 ("budget exhaustion is a MANDATORY
   escalation, never a self-approval"), all depend on knowing when task 1's budget is "exhausted" —
   but there is nothing to exhaust if no number was ever set. Left as-is, an executor could
   legitimately read this as "loop 10 times" or "loop 10,000 times," with a large difference in
   wall-clock cost and host load, and the proposal's own promise of "a stated, bounded investigation
   budget" (proposal.md "What Changes") would not actually be true of the artifact as written.
   **Required revision:** state a concrete iteration count and/or wall-clock time cap for the
   spec-under-contention loop (e.g., "up to N iterations or T minutes of wall-clock time, whichever
   comes first"), sized deliberately for a single bounded investigation session, mirroring the
   concreteness already given to method 2.

2. **`design.md` Decision 1 / `tasks.md` 1.1 — "total concurrent JVMs capped at 3-4" is ambiguous
   about what counts as one JVM, and this ambiguity can concretely double the real host load.**
   `backend/build.sbt` confirms `Test / fork := true`: an `sbt testOnly <spec>` invocation run as a
   batch command is itself an sbt-launcher JVM that then forks a child JVM to actually run the test
   (HEL-924's `Global / concurrentRestrictions` only governs forked-group concurrency *within one sbt
   session*, not across separately-launched `sbt` processes). If "the spec loop + 1-2 contenders,
   capped at 3-4 concurrent JVMs" is read as "3-4 separate `sbt testOnly` process invocations," the
   actual JVM count on the host could be up to double that (each invocation = 1 driver JVM + 1 forked
   test JVM), even though the sbt driver JVM is mostly idle while its child runs and so is lighter than
   a second heavy contending JVM — the point is the plan does not say which count it means, and
   CLAUDE.md is explicit that a hardware cap must be stated explicitly to whoever executes it or "it
   will take everything." This is exactly the "spec + contending processes" combination the
   orchestrator's brief asked me to check, and as written a competent implementer could read it two
   ways with different real resource consequences. **Required revision:** state concretely how many
   separate OS-level `sbt` invocations are permitted (not just "JVMs"), and whether the spec loop
   should reuse one persistent sbt shell session across its repeated `testOnly` runs (to avoid
   re-spawning a driver JVM every iteration) rather than a fresh batch `sbt "testOnly ..."` call per
   iteration.

### Non-blocking notes

- The fix-validation step for an H2 finding (tasks.md 4.2, 5.2) re-runs "whichever reproduction method
  originally found the failure" — if that method was the cheaper spec-under-contention approximation
  rather than a genuine full-suite loop, the "measured settlement latency" used to justify the new
  timeout, and its post-fix validation, is only as representative of real full-suite contention as
  that approximation is. This isn't a blocking defect (the ticket's own AC text sanctions the
  approximation, and task 5.3 does still require one full `sbt test` pass with no regression), but if
  the executor lands on H2 via method 1 alone, I'd want the fix's timeout headroom to be generous
  rather than tight, and the executor should say explicitly which method (1 or 2) actually produced
  the repro used for red-before/green-after, so a reviewer can judge representativeness.
