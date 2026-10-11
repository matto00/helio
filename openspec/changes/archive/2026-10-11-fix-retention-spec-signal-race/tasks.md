## Standing Constraints

- [C1] Judge red/green sbt runs by ScalaTest output ([hel1468-guard] summary failed=N, *** FAILED *** lines), never by exit code

## 1. Tests

- [x] 1.1 Reproduce: on unfixed ordering, add a delay between signal and increment in both stubs; run the spec 3x; it
  fails at the `historyCalls` reads every run; save log to the run evidence dir (verify: log shows failures)
- [x] 1.2 Fix: reorder `thinPass`/`purge` stubs to increment, signal, build; verify the spec passes
- [x] 1.3 Prove fix: apply the same delay after the signal on the fixed ordering; spec passes 3x; revert; save log
- [x] 1.4 Review `OutputHistoryRetentionService` for a real race; record finding in evidence (verify: written note)
- [x] 1.5 Run the spec plus `OutputHistoryRetentionServiceSpec` with `[hel1468-guard]` visible; full pre-commit gates
