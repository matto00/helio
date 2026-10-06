## Evaluation Report — Cycle 3 (evaluation-3.md), head 8194c92c3bdddd2c98f164f50a91bef7c7ada885

### Phase 1: Spec Review — FAIL (one factual error in docs)
- `git diff b0ecdd87 8194c92c --stat`: only design.md (1 line), evaluation-2.md and profile.md changed. Nothing outside docs. Pushed head 47f581f0 evidence run is on the same code.
- CR2 resolved: stale "Still unmeasured" and the probe-correction blob are gone, "Imbalance (H)" paragraph updated, run 37405371525 recorded accurately (302/358/366/381 s, 1251+1481+1409+1816=5957, spread 79 s, honest note that in-sample balance did not carry over), "Remaining, outside this PR" added. design.md D7 now says `backend-compile-v3-<os>-` and matches the YAML.
- CR1 only partly resolved. The cache-entry table now lists every entry on refs/pull/773/merge (ids and sizes match `gh api .../actions/caches`; the node-cache row and the stated post-merge writes are accurate). BUT row 8534216644 `sbt-4d38ac7e...` (955,535,781 B) is labelled "orphan of an earlier key iteration". That is wrong: 4d38ac7e... is the current head key. `sha256(sha256(backend/build.sbt))` = 4d38ac7e3feb... (the only build.sbt in the tree), and every leg of runs 37405371525 and 37407554387 logs "Cache restored from key: sbt-4d38ac7e...". The live entry is mislabelled and the orphan total is overstated: three entries (8534380210, 8535305793, 8535388018, ~2.9 GB) are orphans, not four (~3.8 GB). The text "the final workflow uses main's key again, and they will only age out" repeats the error.
- profile.md does not record run 37407554387 (the evidence run for the pushed head); see below.

### Phase 2: Code Review — PASS (no code changed since b0ecdd87)

### Phase 3: UI Review — N/A

### Evidence run 37407554387 (head 47f581f0; code identical to the reviewed head)
- All jobs success including ci-complete. Cold in every leg (`backend-compile-v3-` not found). Legs 379/277/248/387 s (slowest 6:27, within the <=7.0 min cold bound). Verified via gh.
- Tests per leg 1251 + 1816 + 1481 + 1409 = 5957 (suites 103/105/104/104, 0 failed, 0 aborted). Java heap errors: 0 in every leg; maxMemory 3221225472 in every leg; FirstRunRoutesSpec timeouts: 0 (no timeout/TimeoutException lines excluding the simulated one). FirstRunRoutesSpec and RouteTestBaseGuardSpec both ran and passed (one leg each).
- Leg spread 139 s here (248-387 s) vs 79 s in 37405371525: the regenerated weights did not balance wall-clock; runner variance dominates.

### Overall: FAIL (docs only, one-line fix)

### Change Requests
1. profile.md cache table: change row 8534216644 `sbt-4d38ac7e...` from "orphan" to "live: this PR's current dependency key (hash of backend/build.sbt), restored by every leg; not an orphan"; fix the surrounding prose and any count to three orphan entries (~2.9 GB).
2. profile.md: add run 37407554387 (head 47f581f0): legs 379/277/248/387 s, cold, 1251+1816+1481+1409=5957, 0 heap/timeouts, ci-complete success.

### Non-blocking
- Everything else is accurate; the post-merge ACs remain pending as before.
