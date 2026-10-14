# HEL-1594: After HEL-1564: D2 (wait for in-flight sibling writes before answering) has no test that fails when it is removed

## Description

Origin: HEL-1564 (PR matto00/helio#1018, 27a30bb97), lane-reported. Reviewers rated it non-blocking.

HEL-1564's design.md D2: on the "write won, pipeline deleted" recovery path, the run waits for in-flight sibling
writes before answering. No test turns red if that wait is removed. Reviewers judged it low-risk, because the pipeline
is already gone on that path, but the behaviour is unguarded.

Do: add a seam that holds a sibling write open, for example a slow sibling-write wrapper repository in the style of
`LateFinisherSpecBase`. Assert that the answer does not arrive before the sibling settles. Prove it red by removing the
wait. Force orderings with promises, never sleeps.

Archive: `openspec/changes/archive/2026-10-14-late-delete-after-won-succeeds/` (design.md D2). Verify these claims
against the code first.

## Acceptance Criteria

- A seam holds one of the recovery's eager sibling writes open, in the style of `LateFinisherSpecBase`, following
  HEL-1565's capture-at-call-start convention (per-test seam state bound at call start and reset by `resetSeams`).
- A test on the "write won, pipeline deleted" recovery path asserts the answer does not arrive before the held sibling
  settles, and that the answer is still success with exactly one `succeeded` event once it does.
- The test is proven red by removing D2's wait (`settle(siblings)` in `PipelineRunDeletedRecovery`), with the red
  output recorded; the removal is never committed.
- Orderings are forced with promises, never sleeps.
- The ticket's claims are verified against the code first; if D2 were unobservable by construction, that would be
  documented instead of a vacuous test (premise validation found it observable).

## Driver context

Runs overnight, test-only, backend, no UI. Every test-run claim must show this worktree's own paths and executed test
counts (HEL-1595: sbt 2 may replay cached test output). Local caps: `nice -n 19`, at most 3-4 workers, foreground
`sbt testFull` shards.
