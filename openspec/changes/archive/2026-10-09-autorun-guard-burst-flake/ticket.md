# HEL-1439: AutoRunGuardBurstProofSpec flaky in CI ("4 was not equal to 3")

## Description

Origin: HEL-1390's PR matto00/helio#883. The first CI run failed `AutoRunGuardBurstProofSpec` with "4 was not equal
to 3". The PR doesn't touch that area; a re-run of the failed job passed. The spec was last touched by HEL-1384
(matto00/helio#875, fire-time run-config gate). The lane suspects, unconfirmed, that a rate window rolls over
mid-test.

## Acceptance Criteria

- Root-cause with a probe (systematic-debugging law): reproduce under load or with a forced window boundary. Don't
  just add retries.
- Fix the test's time dependence (e.g. the HEL-1374/1196 clock seam, `PipelineRunService` guardClock), or the
  production race if it's real.
- Show the red and the green; a loop run (e.g. 30x) stays green under `nice -n 19` with <=4 workers.

## Driver context (claims to verify)

- Seen once in PR #883's CI; passed on re-run. Since HEL-1384, HEL-1429 (#895) split `PipelineAutoRunDebounceFirer`
  out of PipelineSchedulerService, and HEL-1374 added the `guardClock` seam on PipelineRunService.
- sbt 2.0.9 forked tests can exit 0 while printing "*** N TESTS FAILED ***" (HEL-1468, in flight): a loop iteration
  counts as green only if its log has no `TESTS FAILED`, `*** FAILED`, or `RUN ABORTED`, and does show the spec's
  tests passing.
