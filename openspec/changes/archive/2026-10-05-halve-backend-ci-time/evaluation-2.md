## Evaluation Report — Cycle 2 (evaluation-2.md), head b0ecdd87537e130b07d88dcdddcbe43231c03bf7

### Phase 1: Spec Review — FAIL (one reporting defect, docs only)
Verified OK:
- ci.yml diff vs origin/main touches only: workflow `concurrency`, `timeout-minutes` on frontend/security/ci-complete, and the backend job (strategy, env, compile-cache restore/save, JUnit upload). e2e has no hunk. C7 satisfied; `backend/.sbtopts` untouched. Dependency cache key `sbt-${{ hashFiles('**/build.sbt') }}` is identical to main's text.
- Compile-cache save condition: `push && ref == refs/heads/main && matrix.shard == 0 && steps.compile-cache.outputs.cache-hit != 'true'` (implicit success()). PRs never save; a partial restore-key hit reports cache-hit false so main re-saves; exact hit skips. Prefix `backend-compile-v3-` is outside the `sbt-` namespace. Correct.
- Concurrency: group `ci-<workflow>-<PR number | run_id>`, cancel-in-progress only for pull_request. Live proof: run 37400092850 (head 122d8d8c) is `cancelled`; the next run on the PR is the superseding one.
- Timeouts vs measured (re-pulled via gh): backend legs 215-385 s -> 15 min (>=2.3x worst cold); frontend 296-463 s -> 20; security 60-90 s -> 5; ci-complete 2-4 s -> 2. Table in profile.md matches.
- Profile spot-checks all match gh: 37391616534 att1 246/345/281/364, att2 292/354/246/355, att3 280/244/355/327 (security failed, ci-complete failed; backend green); 37400422292 head 03e645e1 (backend 369/345/364/379, security failed); 37387080368 att1 311/284/353/237, att2 223/218/213/202, ci-complete success.
- Partition at head: with HELIO_TEST_SHARD_COUNT=4, `show Test/testGrouping` exits 0 for shards 0-3 (the exactly-once guard recomputes all shards each time); definedTests = 416.
- MISTAKES.md / spec / design deltas consistent; C2 respected (no HelioRouteTest/RouteTestBaseGuardSpec change).

Issue (task 7.4, owner scope "report each cache entry's size and how many entries a run writes"): `gh api .../actions/caches` shows four ~955 MB `sbt-<hash>` entries on `refs/pull/773/merge` (ids 8534216644 `sbt-4d38ac7e...` [the current head key, restored by every leg of run 37405371525], 8534380210 `sbt-782450eb...`, 8535305793 `sbt-20d14a1e...`, 8535388018 `sbt-6cb46497...`; 955,535,781 / 955,533,443 / 955,535,121 / 955,538,612 bytes) plus three setup-sbt diskcache entries on the PR ref. profile.md section "Cache entries (task 7.4)" lists none of the ~3.8 GB of sbt-<hash> entries; it names only the compile v2 entry and one diskcache entry. Three of the four are orphaned by the earlier widened-key iterations (~2.9 GB) and will only age out via 7-day eviction. After merge, main's `build.sbt` hash changes, so the first main push will write one new ~911 MiB entry. That cost and the orphans are exactly what the owner asked to see.

### Phase 2: Code Review — PASS
No code changes since cycle 1 beyond ci.yml/weights (reviewed above). Weights file regenerated, 416 suites. build.sbt/TestShards unchanged.

### Phase 3: UI Review — N/A

### Evidence run 37405371525 (head b0ecdd87, COLD; all 9 jobs success, ci-complete SUCCESS now that HEL-1319 is merged)
- Cache: every leg `Cache not found for input keys: backend-compile-v3-Linux-e6bf...` (cold, as expected); sbt dependency cache restored from `sbt-4d38ac7e...`.
- Leg execution (started->completed): leg 0 302 s, leg 1 358 s, leg 2 366 s, leg 3 381 s; slowest 381 s (6:21), median of legs 362 s. Within the <= 7.0 min cold no-regression bound; not the 5.0/5.5 target (cold).
- Tests per leg: 1251 (103 suites) + 1481 (104) + 1409 (104) + 1816 (105) = 5957 = 5954 + 4 - 1; 416 suites, 0 failed/aborted.
- RouteTestBaseGuardSpec ran in leg 2 and FirstRunRoutesSpec in leg 3, both green.
- "Java heap": 0 in all legs; maxMemory 3221225472 in every leg; FirstRunRoutesSpec timeouts: 0 (the single "timed out" hit in leg 3 is a test's simulated `upstream lookup timed out`).
- Weights balance: ScalaTest per leg 2:17 / 2:40 / 2:42 / 2:54 (spread 37 s, down from ~60 s in attempts 1-3) but leg wall spread is 79 s (302-381 s), mostly runner/compile variance; leg 0 is still lightest. Improved, not tight; in-sample prediction (8 s) did not carry over.

### Overall: FAIL (docs-only)

### Change Requests
1. profile.md "Cache entries (task 7.4)": list every entry on `refs/pull/773/merge` from `gh api repos/matto00/helio/actions/caches` (the four `sbt-<hash>` ~911 MiB entries with ids/sizes/created times, three setup-sbt diskcache entries, sbt-compile-v2 entry), say which are orphans from the earlier widened-key/ build.sbt iterations, state the expected post-merge write (one new `sbt-<hash>` ~911 MiB on first main push because build.sbt changed), and delete nothing.
2. profile.md: update/remove stale text: the trailing "Still unmeasured" section (claims 6.2/ci-complete not done), and the "Imbalance ... left out of H" paragraph now that weights were regenerated; add this run's (37405371525) legs, cold state, 5957 reconciliation. Align design.md D7's `sbt-compile-v<n>-` prefix wording with the actual `backend-compile-v3-`.

### Non-blocking Suggestions
- Leg wall variance (302-381 s) is larger than weight balance explains; if the post-merge main median misses 5.5 min, the warm-path evidence (3:43) is what carries the AC.

### Pending (post-merge)
- First main run is cold and seeds `backend-compile-v3-`; PR restore of a main entry; 5-run main median <= 5.5 min; flake rate.
