## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- backend/build.sbt: Test/fork, testForkedParallel=false (l.107), ForkedTestGroup cap default 4 (l.167-168), Def.uncached testGrouping with hash grouping into HEL924_TEST_GROUP_COUNT=8 (l.179-195). Matches design Context; D3 "unsharded byte-for-byte" is feasible by leaving that path intact.
- ci.yml backend job (l.121-): heap lines `printf -Xmx3g > .jvmopts` + `sbt -batch -J-Xmx3g "eval ...; compile; testFull"` as D4 says; the comment still claims "no thin client", which design D4 correctly flags. ci-complete (l.447-462) `needs: [frontend, backend, security, e2e]`, fails on failure/cancelled; a matrix job under the same id aggregates to failure if any leg fails, so no needs change is required. check-precommit-ci-parity reads job ids / ci-complete needs, unaffected by a matrix.
- CI run 37347856913 backend job: 17:21:54-17:34:33 (12m39s); "Compile and test" step 17:22:13-17:34:28 (12m15s); setup steps ~19s. Consistent with premise-validation.md and design arithmetic (~1.9 min fixed, ~10.5 min tests).
- Driver constraints mapped: removals ledger-gated (D5, C2, spec); HelioRouteTest/RouteTestBaseGuardSpec protected (D5, C2, task 6.3); EmbeddedPostgres per fork only (C5, D6); HEL-1292 explicitly not folded in because heap lines are unchanged (D4); edits confined to backend job, .sbtopts untouched (C4, non-goals); no sbt testFull at this gate honored; escalation path for unreachable target / unnameable survivor exists (D5).
- ACs: profile before/after + top 20 (D1, 1.2, 6.2); count + removal list (D5, 2.1, spec reconcile); HEL-1228 guarantees (6.3); <=5.5 median measured post-merge (D8, honest about being unmeasurable pre-merge); sharding gates via ci-complete (D2, 3.4, spec).
- No TODO/TBD placeholders; no internal contradictions found between proposal, design, tasks, spec.

### Verdict: CONFIRM

### Non-blocking notes
- Post-merge flake-rate reporting (AC) lives only in D8 prose, not a task; the orchestrator should carry it into Phase 4.
- Implementer must drop empty groups when LPT-splitting a small shard (sbt Group with zero tests), and handle the weights file being read relative to the build base dir.
- Task 3.4: confirm in a real PR run that ci-complete reports the aggregate (as D2 already requires); the cache key widening is only for the backend job's cache step (e2e has its own).
- Step 1.1 needs a pushed PR before any profile exists; the executor should confirm sbt 2's JUnit XML location under target/** actually exists before relying on the glob.
- Target risk is real (needs ~3.2x test cut); the escalation clause covers it, and N=5 is the stated fallback.
