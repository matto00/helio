# HEL-1195 Reproduction Findings

## Task 1.1 — spec-under-contention reproduction (2026-09-28/29)

**Method** (design.md Decision 1, method 1): ONE `sbt` OS-level invocation chaining 40
`testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec` commands as
separate quoted-arg tasks (no `--continue`, so the session halts at the first failing
command — this naturally satisfies "capture evidence before the next iteration," since
there is no next iteration once a command fails). Concurrently, 2 contending `sbt
testOnly` invocations looped continuously against `PipelineRunServiceSpec` and
`PipelineRunRepositorySpec` respectively until the main loop finished. All 3 concurrent
`sbt` OS-level invocations ran under `nice -n 19` (hardware cap C1). Orchestration
script: `repro-evidence/../` (see `repro-task1.sh` invocation recorded below);
full console output: `repro-evidence/task1-main-loop.log`.

**Result**: bound reached by failure, not by the 40/20-min cap.
- Iterations completed before the failing one: **33** (recorded via
  `ITERATIONS_COMPLETED=33` in the log's own summary block).
- Elapsed wall-clock at failure: **159 seconds** (`ELAPSED_SECONDS=159`) — well under
  the 20-minute cap.
- Failures observed: **1**.

### Captured failure (verbatim)

- **Test name**: `PipelineRunService pipeline-run guard: rate limit (HEL-505 tasks.md
  8.2) should rejects the (limit+1)th submission within a window with
  TooManyRequests + a positive retryAfterSeconds`
- **Assertion message (verbatim)**:
  ```
  expected Left(TooManyRequests), got Right(RunResultResponse(Vector({"name":"alice"}),1,Map(),1,Some(8dca23be-84bf-487a-b6bf-6d5795577e20),false,None,false,None,None,Vector())) (PipelineRunGuardIntegrationSpec.scala:188)
  ```
- **Surefire XML**: copied to `repro-evidence/1/TEST-com.helio.services.pipelines.PipelineRunGuardIntegrationSpec.xml`
  before any further iteration or cleanup (the sbt session halted on this failure, so
  the XML was never at risk of being overwritten by a subsequent run).
  `timestamp="2026-09-28T23:58:01"`, failing testcase `time="0.471"`.
- Console log location of the failure: `repro-evidence/task1-main-loop.log:7191-7192`.

Task 2 (full-suite loop) was **not needed** — task 1.1 found a failure within its own
budget (33/40 iterations, 159s/1200s), so per design.md Decision 1 the escalation to
the expensive full-suite loop does not apply.

## Task 3.1 — Classification

The captured failure is **Hypothesis 3: a different test in the spec** — specifically
one of the **rate-limit tests**, literally named as a candidate in the ticket's own
H3 text ("the rate-limit tests"). It is NOT hypothesis 1 (the failing assertion has
nothing to do with a `4 != 3` concurrency-admission count — the concurrency-cap test
itself, lines 265-303, passed in this run, see XML testcase list) and NOT hypothesis 2
(no latch/settlement text anywhere in the failure — `awaitAllSettled`'s own
`withClue` text, "N of the burst's submissions never settled," does not appear; the
failing test doesn't even use `awaitAllSettled` or the `GatedExecutionBackend`).

### Root cause (probe-confirmed)

**Root cause (one sentence, failing layer = test, not production):**
`PipelineRunGuardIntegrationSpec`'s six rate-limit tests (lines 193-260) issue their
2-3 sequential, `await`-blocking `service.submit(...)` calls with
`rateWindowSeconds = 60` and no control over wall-clock time; `PipelineRunGuardRepository
.incrementRateIfUnderLimit`'s window bucketing (`bucketStart`, `epochSeconds /
windowSeconds * windowSeconds` — an ABSOLUTE, wall-clock-anchored fixed window, e.g. a
new bucket starts at every `:00` second of every minute for `windowSeconds=60`) means
that if real wall-clock time happens to cross a window boundary between two of a
test's sequential submissions, the later submission lands in a fresh bucket with its
own counter and is incorrectly admitted instead of rejected — this is the rate
limiter working exactly as designed (existing, already-passing coverage:
`PipelineRunGuardRepositorySpec`, "buckets by window: a submission in a NEW window
bucket does not count toward the prior bucket's cap", lines 175-189), not a
production defect. The integration test never controls for this because
`PipelineRunService.executeRun` calls `pipelineRunGuardRepo.incrementRateIfUnderLimit`
with no explicit `now` argument (defaults to real `Instant.now()`), and no clock
injection seam exists at the service layer — unlike `PipelineRunGuardRepositorySpec`,
which calls the repository directly and passes explicit, deterministic `Instant`
values for exactly this reason.

**Probe:**
```
cd backend && nice -n 19 sbt 'testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunGuardRepositorySpec -- -z "buckets by window"'
```

**Probe output (confirms the mechanism):**
```
[info] PipelineRunGuardRepository.incrementRateIfUnderLimit
[info] - should buckets by window: a submission in a NEW window bucket does not count toward the prior bucket's cap
[info] Tests: succeeded 1, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
This existing, deterministic, already-passing unit test proves the exact mechanism
(a submission bucketed into a new window is unaffected by the prior window's
exhausted cap) using explicit `Instant` values chosen to straddle a boundary — the
same mechanism that, driven by REAL wall-clock luck instead of an explicit `Instant`,
produced the captured integration-test failure above.

**Corroborating timing evidence**: the captured failure's XML records
`timestamp="2026-09-28T23:58:01"` with the failing test's own `time="0.471"`s; the
console log shows the preceding Flyway migration completing at `23:57:59.524`,
immediately followed by test execution — consistent with the rate-limit describe
block's sequential submissions (the failing test is the FIRST test executed in the
suite) straddling the `23:58:00.000` absolute-minute window boundary.

This is a genuinely load-*correlated* (not load-*caused*) flake: contention widens
the per-test execution window slightly (0.471s here vs. ~0.06-0.2s for an
uncontended run of the later tests in the same suite), which raises — but does not
create — the small, constant per-run probability of straddling an absolute-minute
boundary purely by chance. It can, in principle, also occur completely uncontended,
just far less often (consistent with HEL-1188's original single failure in an
otherwise-idle local full-suite run, and with "isolated re-run green" being
uninformative either way for a boundary-luck race).

## Fix (H3 branch, design.md Decision 3 / tasks.md 4.3)

Test-only change: raise `rateWindowSeconds` from `60` to `3600` in all six rate-limit
tests in `PipelineRunGuardIntegrationSpec` (none of their assertions depend on the
specific window value — they only assert `retryAfterSeconds > 0` or
right/left shape). This does not touch `awaitAllSettled`, the settlement latch, or
any production code (`PipelineRunGuardRepository`, `PipelineRunService` unchanged) —
the rate limiter's fixed-window semantics are correct and intentional (Non-Goals:
"re-opening HEL-505's rate-limit... design decisions" is explicitly out of scope).
Widening the window from 60s to 3600s reduces the boundary-crossing exposure by
~60x (a test would need to take over 3600s instead of 60s to have the same absolute
per-run collision probability) — analogous in shape to Decision 3's H2 guidance
("adjust to a value justified by measured/probe-confirmed evidence, with headroom"),
applied here to a window size instead of a latch timeout, backed by the same standard
of evidence (the probe above + the timing correlation), not a blind round-number
guess.

See `files-modified.md` for the exact diff summary and task 5's post-fix
verification runs (isolation 10x, reproduction re-run 3x, full suite once).

## Task 5 — Post-fix verification (2026-09-29)

**5.1 — isolation, 10x** (`repro-evidence/task5-1-isolation.log`): one `sbt` OS-level
invocation chaining 10 `testOnly
com.helio.services.pipelines.PipelineRunGuardIntegrationSpec` commands, no contenders,
`nice -n 19`. All 10 iterations green: `Tests: succeeded 10, failed 0` per iteration
(10 tests in the spec x 10 iterations = 100/100 individual test executions passed).
Total wall time ~3s (uncontended, no Flyway/JVM-boot repeated — same forked JVM
reused across iterations as required by design.md).

**5.2 — reproduction re-run, 3x post-fix**: already completed pre-pause (see pause
checkpoint in `workflow-state.md`) — 3 rounds, 40/40 iterations each, 0 failures,
under the same 3-way sbt contention as the original task-1.1 repro.
`repro-evidence/task5-2-round{1,2,3}-*.log`.

**5.3 — full backend suite, once** (`repro-evidence/task5-3-full-suite.log`): single
sequential `nice -n 19 sbt test` invocation (no concurrent contending workload, per
design.md Decision 1 method 2 / tasks.md 5.3), run fresh after the prior attempt was
killed mid-run by the pause (that log was discarded as invalid, not reused). Result:
`Total number of tests run: 4883`, `Tests: succeeded 4883, failed 0, canceled 0,
ignored 0, pending 0`, `[success] Total time: 320 s (0:05:20.0)`. 4883 matches the
pre-change baseline (HEL-1188's own final-gate run, per the ticket description) —
0 new failures, 0 regressions anywhere in the suite, not just in
`PipelineRunGuardIntegrationSpec`.
