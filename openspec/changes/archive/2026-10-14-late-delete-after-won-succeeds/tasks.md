## Standing Constraints

- [C1] A forced-ordering test must also force (and assert) every concurrently running write that could otherwise surface its failure first; succeeded-event assertions are exact counts, not at-least-one.

## 1. Red first

- [x] 1.1 Read MISTAKES.md and the HEL-1518 / HEL-1544 archived designs (`openspec/changes/archive/2026-10-13-late-finisher-404-reap-window/`, `openspec/changes/archive/2026-10-13-fix-late-finisher-spec-flake/`); verify every Context claim in design.md against the code; record any disagreement in `evidence.md` before writing code.
- [x] 1.2 In `LateFinisherRunSpec`, flip the HEL-1544 404 test and add tests 2-4 and 7 of design.md D5 (new wrapper seams in the existing style; no sleeps used to force an ordering). Verify: run the spec against UNMODIFIED production code; tests 1-3 and 7 fail for the expected reason (404 / failure instead of success), test 4 records today's answer. Paste the red output into `evidence.md`.
- [x] 1.3a Check the test-file size budget in CONTRIBUTING.md / check-scala-quality.mjs for `LateFinisherRunSpec.scala` (already 387 lines); if the additions breach it, move the HEL-1544/HEL-1564 delete-after-won tests into a sibling spec sharing a fixture trait. Verify: quality check output in `evidence.md`.
- [x] 1.3b Tighten the existing HEL-1544 delete-before-list test to assert EXACTLY one `succeeded` event (C1). Verify: green before and after the fix.
- [x] 1.3 Sequence the HEL-1518 item-2 delete test (D5.6) and audit other mid-run pipeline-delete tests for the same order sensitivity. Verify: list the audited tests and outcome in `evidence.md`.

## 2. Fix

- [x] 2.1 Implement design.md D1-D2 (recovery requiring `won = true` AND pipeline gone; D1b re-fail as `RunNoLongerOpen(Missing)` when `won = false`, pipeline gone, other failure; settle sibling futures on BOTH the D1 success path and the D1b re-fail path; WARN log; original failure otherwise). Verify: `LateFinisherRunSpec` fully green.
- [x] 2.2 Mutation checks (D5.4): drop the pipeline-gone check -> test 4 red; drop the `won` check -> a D7 lost-write test red; narrow the recovery to `RunNoLongerOpen` only -> test 3 red; drop D1b -> test 7 red. Restore. Verify: red outputs in `evidence.md`.
- [x] 2.3 Determinism: run `LateFinisherRunSpec` 10 consecutive times (`nice -n 19`, one at a time). Verify: 10/10 green, tallied in `evidence.md`.

## 3. Gates

- [x] 3.1 Run the related pipeline-run specs (`PipelineRunService*`, `*Reap*`, `*RunGuard*`, `*Executor*`, `OutputHistory*`, `NodePayload*` as present) and the Scala quality / openspec hygiene checks. Verify: green, recorded in `evidence.md`.
- [x] 3.2 Full backend suite via `sbt testFull` in foreground shards (`nice -n 19`, forked-group concurrency 1, `HELIO_TEST_JVM_XMX=3g`). Verify: all shards green; record pass counts in `evidence.md`.
- [x] 3.3 Update the scaladoc of `onUnblockedRunSuccess` / `failIfLostTerminalWrite` (and any comment that says a post-delete run always 404s) to describe the HEL-1564 rule. Verify: `grep -n "wherever" ` and HEL-1518 comments in the touched files are consistent with the spec delta.
