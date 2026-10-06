## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- Diff vs live base 8cff543bc (HEAD 5fb06709ced8122202bc8f9cef98ff2895d9b418): 3 backend files + spec/artifacts.
- Root cause: old code discarded the Future of `credentialRepo.delete(...).recover{}` and returned Right -> real product defect (success before old credential gone; failed delete swallowed). Fix: one `withUserContext` (app pool, RLS-enforced, not privileged) transaction: FOR UPDATE lock-read, insert new, repoint, delete old (order required by ON DELETE RESTRICT, V93). Future completes post-COMMIT. Semantics beyond "old gone on return" unchanged -> no escalation needed.
- Concurrency: FOR UPDATE first statement serialises concurrent rotations; a concurrently deleted/pending connector yields Left with nothing written. Encryption happens before DB work (no-key = zero writes). `create`/`delete` retain behaviour via insertAction/deleteAction.
- D4 test (row lock held by separate superuser connection, 1.5s bounded poll, then release + Await 10s): fixed code is deterministically blocked, so it cannot be flaky-green; hang risk bounded (finally releases, Await has timeout). Red-on-unfixed log recorded in probe.md (16 pass / 1 fail at line 459). D3 rollback test covers delete failure.
- Contention evidence: loop-harness classpath (scratch/cp2.txt) points at this worktree's target classes/test-classes; every one of 50 logs (A/B x25) shows "Tests: succeeded 18, failed 0" (grep: 50/50), and 18 includes the new tests, which can only pass with the fixed main classes. 2 concurrent JVM forks each with own EmbeddedPostgres + 2 nice-19 burners (4 workers) -> genuine 2-fork contention. Honest disclosure that unfixed code didn't reproduce under load (0/80), so D4 is the real red proof.
- I re-ran `nice -n 19 sbt testOnly ...ConnectorRepositorySpec`: 18 run, 18 passed. sbt client shut down. No FirstRunRoutesSpec timeout / Java heap space observed by me; probe.md claims full suite 6023 pass, none observed.
- C1/C2: no ci.yml/playwright.config.ts/.gitignore changes in diff; scratch/ untracked and untouched; no UI changes.

### Verdict: CONFIRM

### Non-blocking notes
- The persisted root-cause log (probe-red.log) is untracked/gitignored; probe.md excerpt suffices.
- Long line in rotation `yield` could be wrapped for readability.
