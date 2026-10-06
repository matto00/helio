## Skeptic Report - design gate (round 3, skeptic-design-3.md)

Reviewed head 517b98ea928e4d6efb541e406652dcec0de3e5e8 (artefacts uncommitted edits in the working tree). Did not push, rerun CI or run the suite.

### Round-2 items
1. D8 vs D7 main-only save: RESOLVED. D8 now states every pre-merge final-head run is cold, labels each run cold/partial/exact, bounds cold runs at <= 7.0 min (no-regression vs 12m39s, explicitly not the target), takes the warm <= 5.0 min figure from exact-hit run 37387080368 (head 517b98ea; I confirmed in skeptic-2 that it ran 1444 tests on leg 0, so cache did not serve stale results), and declares the 5.5 min median post-merge-only. Task 6.2 matches.
2. Dependency key: RESOLVED in design.md D7 (reverted to main's `sbt-${{ hashFiles('**/build.sbt') }}`), task 3.4 and 7.3 agree. NOT yet reflected in ci.yml at 517b98ea (line 166 still widened) - correct for a design gate, tasks 3.4/7.3 are unchecked and own it. BUT proposal.md line 19 still says "Widen the sbt cache key to all build-definition inputs" - see CR1.
3. C4: RESOLVED. C4 retired, C7 added in tasks.md and workflow-state.md, ownership vs HEL-1288 stated in Risks. BUT proposal.md Non-goals still says "No change to the e2e, frontend or security jobs" - contradicts D11/C7/ticket owner scope (timeouts on frontend/security) - see CR2.

### Judgement on D8's pre-merge/post-merge split
Honest and sufficient, and the right call: the ticket AC itself defines the target as the median of 5 green main runs after merge, so it cannot be proven pre-merge under any plan; the alternative (PR runs saving PR-scoped entries) is exactly the cache sprawl the owner is trying to stop (HEL-1299). It does not hide an escalation-worthy risk provided it stays disclosed. Residual risks, recorded as non-blocking:
- The warm evidence is an exact hit (zero compile). Post-merge main runs will almost always be partial hits (backend/src hash changes with nearly every merge, so a main push rarely finds its exact key), costing ~10-30 s more compile per leg. Margin 5.0 bound vs ~3.7 min observed warm slowest leg covers this, but the executor should say so in the PR rather than imply exact-hit == steady state. Also, each backend-changing main push writes a fresh entry (~70 MB + CAS), so the entry count is per-merge, not "one"; that is HEL-1299's to prune, state it.
- Cold bound 7.0 vs observed cold legs ~6.5 (slow-runner legs up to 6:12 earlier) leaves only ~0.5 min; a slow runner could fail the bound without a regression. Reruns are allowed, acceptable.
- If post-merge median misses 5.5, the AC fails after the PR is gone; D8 says report unmet, not softened. That is correct; the orchestrator should pre-brief the driver that the first post-merge run is cold and excluded/flagged in the 5-run median.
No ESCALATION needed.

### Other whole-plan checks
- ticket ACs traced: profile artefact (1.x, profile.md), test counts + ledger (2.x, 6.2), HEL-1228/RouteTestBaseGuardSpec (C2, 6.3), 5.5 median post-merge (D8), no .sbtopts (C7), HEL-1292 not folded (D4). Owner scope 1 (D10, 7.1, 7.5), 2 (D11, 7.2), 3 (D7, 7.3, 7.4) covered.
- D10 correct (per-run_id group on main avoids pending-run cancellation). Spec delta covers concurrency, timeouts, gating, exactly-once; consistent with D3.
- Minor: 3.4 and 7.3 overlap on the cache step; tasks order lists group 7 before 5/6 (harmless).

### Verdict: REFUTE (two small artefact contradictions)

### Change Requests
1. proposal.md line 19: replace "Widen the sbt cache key to all build-definition inputs; cache compile output ..." with wording matching D7 (dependency key unchanged from main; compile output cached via restore-everywhere / save-on-main-push-shard-0-only).
2. proposal.md Non-goals ("No change to the e2e, frontend or security jobs"): amend to "no change to the e2e job (HEL-1288) and no functional change to frontend/security beyond job-level timeout-minutes", matching C7/D11.

### Non-blocking notes
- Add to D8/PR text: warm evidence is exact-hit best case; steady-state main is partial-hit; per-merge cache entry growth is deferred to HEL-1299.
- Flag the first post-merge main run as cold when computing the 5-run median.
