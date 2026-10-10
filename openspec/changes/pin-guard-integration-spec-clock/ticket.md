# HEL-1471: PipelineRunGuardIntegrationSpec uses the system clock with exact budgets over 3600s windows: a real hour boundary can split a bucket (same class as HEL-1439)

## Description

Origin: HEL-1439 (matto00/helio#914, 6902b57f). Root cause there: a spec built `PipelineRunService` without
`guardClock`, so rate windows used real wall-clock boundaries while the test drove a FakeClock, and a burst crossing
a real boundary was admitted in two windows. `PipelineRunGuardIntegrationSpec` has the same weakness: the system
clock, exact budgets of 1–2, 3600s windows. A test run straddling a real hour boundary can split a bucket and flake.

## Acceptance Criteria

- Pass a fake clock as `guardClock` (the HEL-1374/1439 pattern) in `PipelineRunGuardIntegrationSpec`.
- Red-first by forcing a boundary crossing (probe), green after.
- Loop proof judged by LOG (grep for `TESTS FAILED` / `*** FAILED` / `RUN ABORTED`, because of HEL-1468), not the
  sbt exit code.
- Grep the test tree for any other spec constructing `PipelineRunService`/rate-window code without a fake clock, and
  fix the same class there (state which).

## Driver notes (claims to verify)

- HEL-1445 (in flight) migrates every `EmbeddedPostgres.builder()...start()` site; do not change embedded-Postgres
  startup lines.
- Confirm the HEL-1468 guard ran by grepping logs for `[hel1468-guard]`.
