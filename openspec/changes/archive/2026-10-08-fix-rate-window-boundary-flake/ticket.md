# HEL-1374: DatasetWriteAutoRunEndToEndSpec owner-attribution flakes across a rate-window minute boundary

## Description

Seen on HEL-1285's first CI run (170cf380a, `backend (0)`). The owner-attribution case of `DatasetWriteAutoRunEndToEndSpec` failed with `2 was not equal to 1`.

Hypothesis from HEL-1285's lane, not reproduced:

* `PipelineRunGuardRepository` buckets the rate window as `epochSeconds / windowSeconds`, so windows are aligned to whole minutes.
* The test ran from 22:55:58 to 22:56:00, across a minute boundary. A new window lets a second run through.

## Do

* Reproduce the failure by pinning the clock or window so the test straddles a boundary.
* Fix the test so it controls the window. Don't loosen the assertion.
* Decide whether wall-clock-aligned windows are intended product behaviour. Change product code only with a reason.

Also record in MISTAKES.md something HEL-1285's skeptic found: `sbt` started in one worktree can attach to another worktree's server and report exit 0 for the wrong build. Use `sbt -batch -Dsbt.server.autostart=false` and check the project path.

## Acceptance Criteria

- A measured red: the unmodified owner-attribution case fails with `2 was not equal to 1` when positioned to straddle a rate-window boundary, and passes when it does not (probe-confirmed root cause).
- The owner-attribution case controls the rate window deterministically; its assertion (`runCount(pid) shouldBe 1`) and its attribution mutation-sensitivity are unchanged; no timing window widened, no retry-until-green.
- The fixed case stays green when positioned across a boundary, and goes red again if the clock control is removed (mutation).
- A recorded decision on whether wall-clock-aligned windows are intended product behaviour; product code changes only with a stated reason.
- MISTAKES.md records the sbt cross-worktree server-attach hazard with a verified safe invocation.

## Driver context (claims to verify)

- HEL-1196 (Backlog) proposes a clock seam through `PipelineRunService` to the guard. Implement it here only if it is the narrowest fix for this flake; do not absorb HEL-1196's wider test conversions.
- Do not fix by widening a window or retrying until green.
