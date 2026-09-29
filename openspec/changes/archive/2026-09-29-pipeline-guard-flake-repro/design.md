## Context

`PipelineRunGuardIntegrationSpec`'s concurrency-cap test (lines 265-303) submits 8 concurrent
REAL runs against `maxConcurrent=3` through a `GatedExecutionBackend` whose `execute()` fires
`onAdmitted()` on entry (before blocking on `gate`), counting down a `CountDownLatch(8)`
(`awaitAllSettled`, `latch.await(5, TimeUnit.SECONDS)`, lines 180-183). HEL-1184 (`55ad1d6d`)
replaced a DB-poll coordination with this latch after root-causing a settlement race (probe:
6/230 pre-fix failures under a forced small connection pool, 0/200 post-fix). One day later,
HEL-1188's local full `sbt test` (head `069a11bd`) showed 4882/4883 with one failure in this
spec — name/assertion unrecorded, worktree since cleaned up. See proposal.md for why.

`PipelineRunService.executeRun` (lines 959-1065): after `insertRunIfUnderConcurrencyCap`
resolves `Inserted`/`NotOwned`, the code runs `deleteOldRuns(...).recoverWith { case _ =>
Future.successful(()) }` (an extra DB round-trip) BEFORE `backend.execute()` is called — the
point where `onAdmitted()` fires. This gap did not exist in HEL-1184's design/PR reasoning
("settlement signalled strictly before blocking on the gate") and could plausibly widen under
DB contention. This is a candidate mechanism only, found on inspection — not yet probed.

`backend/build.sbt` (HEL-924): `sbt test` splits into 8 forked-JVM groups, capped at 4
concurrent (`Tags.ForkedTestGroup` limit), specifically because unconstrained
EmbeddedPostgres-backed suites previously caused enough CPU/IO contention to fail unrelated
suites under full-suite load. Relevant background for what "full-suite load" actually means on
this project — not itself a hypothesis.

## Goals / Non-Goals

**Goals:**
- Reproduce the HEL-1188 failure (or an equivalent failure in this spec) under conditions that
  approximate full-suite load, within a stated, bounded investigation budget.
- For every failure observed during reproduction: capture the test name, assertion message
  verbatim, and the surefire/test-report XML, into a durable evidence file before any cleanup.
- Determine which of hypothesis 1 (`4 != 3`, guard under-serialization), 2 (latch timeout under
  load), or 3 (a different test in the spec) is confirmed — or, if none reproduces within
  budget, escalate with what was tried rather than guess.
- Fix only the probe-confirmed cause; add a `withClue`-style guardrail so a future failure in
  this spec self-describes (test name + admitted/settled counts + timing) regardless of outcome.

**Non-Goals:**
- Re-opening HEL-505's rate-limit/dry-run/trigger-source decisions.
- Any production-code change UNLESS hypothesis 1 is probe-confirmed, and only after an explicit
  escalation to the human per the ticket's standing constraint (never self-approved).
- Fixing or tuning HEL-924's forked-JVM-group contention control itself.
- Retries, sleeps, or a loosened assertion anywhere, regardless of what's found.

## Decisions

**Decision 1 — Reproduction method, cheapest-first.** Two escalating approaches, in order,
each bounded:
1. **Spec-under-contention** (cheap, first attempt): run `PipelineRunGuardIntegrationSpec` in a
   loop, bounded to **up to 40 iterations OR 20 minutes of wall-clock time, whichever comes
   first** — this is the concrete, stated budget standing constraint C5's "budget exhaustion"
   and tasks.md 3.3 depend on; when either limit is hit with zero reproductions, the loop stops
   and Decision 3's "nothing reproduces" branch applies. Implementation: ONE `sbt` OS-level
   invocation for the loop itself, chaining repeated `testOnly` commands as separate
   semicolon/quoted-arg tasks in a single session (e.g. `sbt "testOnly
   com.helio.services.pipelines.PipelineRunGuardIntegrationSpec"
   "testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec" ...` or an interactive
   `sbt` shell fed repeated `testOnly` commands) — this reuses the SAME sbt-launcher JVM across
   every iteration (sbt still forks a fresh child JVM per `Test`-task execution given `Test /
   fork := true`, so peak concurrent forked-test-JVM count is unaffected; what this avoids is a
   fresh sbt-launcher JVM startup, and an extra idle driver JVM, per iteration). Concurrently,
   run **at most 2 additional,
   separate `sbt testOnly` OS-level invocations** as contenders (e.g. `PipelineRunServiceSpec`,
   `PipelineRunRepositorySpec`), each its own sbt-launcher JVM + one forked test JVM. **Numeric
   cap, stated explicitly per the CLAUDE.md hardware rule: at most 3 concurrent `sbt` OS-level
   invocations at any time (1 spec-loop + up to 2 contenders) — never more, and never relaunch
   the loop's own `sbt` invocation while a prior one is still running.** Every invocation runs
   under `nice -n 19`. (Each invocation's own sbt-launcher JVM is a lightweight, mostly-idle
   bookkeeping process while its one forked child JVM does the real work — capping at 3
   invocations keeps the actual computational load, the forked JVMs, at 3 concurrent, safely
   inside the general 3-4-worker guidance even counting the launcher JVMs as auxiliary, not
   additional, workers.)
2. **Full-suite loop** (expensive, only if (1) doesn't reproduce within its own budget): run
   `sbt test` (the real full suite, `HEL924_TEST_GROUP_CONCURRENCY` left at its default of 4) to
   completion, one iteration at a time — never looped in the background faster than it can be
   observed and stopped. Bounded to at most 3 sequential full-suite iterations (a full run is
   itself heavy; 3 is the stated bound, chosen to stay well within a single investigation
   session without saturating the machine for hours).

**Decision 2 — Evidence capture, mandatory for every failure seen.** Before any cleanup: copy
`backend/target/test-reports/*PipelineRunGuard*` (and any other spec that failed) into the
change dir as `repro-evidence/<n>/`, and record test name + assertion message verbatim in
`repro-findings.md`. A failure in ANY spec during the full-suite loop gets this treatment, not
only `PipelineRunGuardIntegrationSpec` — per the ticket's standing constraint, "any test failure
you see, in any gate, anywhere."

**Decision 3 — Branch on what's found, per the ticket's three hypotheses.** Do not guess from
static reading alone (see Context's `deleteOldRuns` finding — a candidate, not a verdict).
- **H1 (`4 != 3`, or any other guard-admission-count mismatch):** STOP. Do not touch
  `insertRunIfUnderConcurrencyCap`. Raise an `ESCALATION` per the standing constraint — this
  reopens a shipped-in-v0.8.4 production guard and needs a human decision on how to proceed,
  not a self-approved fix.
- **H2 (latch timeout, "N of the burst's submissions never settled"):** this is the test's own
  reliability, not the guard's correctness. Fix shape: extend `awaitAllSettled`'s timeout to a
  value justified by what the repro measured (e.g. observed max settlement latency under the
  reproduced contention, with headroom) AND add instrumentation so a future timeout names which
  submissions never settled and how far `settled.getCount` had progressed — never blindly
  raise the number with no measurement behind it (the ticket's explicit "never fix by" list).
  If the repro traces the delay to the `deleteOldRuns` gap identified in Context, say so
  explicitly and cite the trace; if not, don't claim it.
- **H3 (a different test in the spec):** fix that test's own specific defect; the settlement
  latch and HEL-1184's fix are unrelated and untouched.
- **Nothing reproduces within Decision 1's budget:** escalate per the ticket's and CLAUDE.md's
  budget-exhaustion rule, with the repro methodology tried and iteration counts, rather than
  shipping a speculative fix (HEL-1027 cycle 3 did this and cost a cycle — do not repeat it).

**Decision 4 — Guardrail, independent of which hypothesis is confirmed.** Regardless of
outcome, add a `withClue` (or equivalent) to the concurrency-cap test's final assertions
(`results.count(_.isRight) shouldBe maxConcurrent` and the rejection-count assertion) that
reports the admitted/rejected breakdown actually observed, so a future failure's own test
output records what happened without needing a human to have watched it live. This mirrors
`awaitAllSettled`'s own existing `withClue` pattern.

## Risks / Trade-offs

- [Risk] Neither reproduction approach reproduces the failure at all (genuinely rare,
  load-dependent race) → Mitigation: this is exactly Decision 3's "nothing reproduces" branch —
  escalate with what was tried, do not extend the budget unilaterally or ship a guess.
- [Risk] Running contending workloads concurrently could itself violate the hardware cap if not
  careful about total JVM count → Mitigation: Decision 1 caps total concurrent JVMs at 3-4
  explicitly, `nice -n 19` on every process, and the full-suite loop (already internally capped
  by HEL-924 at 4 concurrent forked groups) is run one iteration at a time, foreground/polled,
  never backgrounded in an unbounded loop.
- [Risk] Evidence capture happens after the fact and misses a failure → Mitigation: Decision 2's
  copy-before-cleanup step runs immediately after every observed failure, before any further
  iteration.

## Planner Notes

- `skip_specs: true` (proposal.md/`.openspec.yaml`): this investigates and, depending on
  findings, fixes a test's own coordination or a production guard against its EXISTING,
  unchanged contract — no spec-level requirement changes under any of the three hypotheses.
- No `.husky/**` or gate-chain script touched by this ticket — CON-132's gate-chain checklist
  does not apply.
- The `deleteOldRuns` gap (Context) is included here as a concrete, previously-unexamined
  candidate the executor should specifically instrument for — not because it's confirmed, but
  because HEL-1184's own design never considered it and it's cheap to check first.
- Revision (design-gate round 1, REFUTE): Decision 1's spec-under-contention loop had no stated
  iteration/time bound (unlike method 2's explicit "3 iterations") and left "concurrent JVMs"
  ambiguous given `Test / fork := true` (each `sbt testOnly` OS-level invocation is itself a
  sbt-launcher JVM plus a forked test JVM). Fixed: stated a concrete "40 iterations OR 20
  minutes, whichever comes first" bound, a persistent-session implementation (reuse one sbt
  invocation across repeated `testOnly` commands, don't relaunch per iteration), and an explicit
  cap of "at most 3 concurrent `sbt` OS-level invocations" (not raw JVM count) for the
  loop-plus-contenders combination.
