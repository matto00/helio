## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 497e2b32143a5da2b56f197dff1817195a5904a3 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/flake-sweep-two-ci/HEL-1758`.
- **AC coverage:** every ticket AC maps to a task. hashFiles root cause and before/after timings map to 1.1-1.5. Hang vs under-provisioned maps to 2.1-2.4. The three e2e candidates map to 3-5 (forced red, then 40/40 at `--workers=2 --retries=0`, or recorded probes). The HEL-1757 decision is D3/3.1. No sleeps, retries or longer timeouts appear as non-goals and in C12.
- **ci.yml facts:** confirmed. `hashFiles` appears at 255, 280, 331, 341 and 395, and nowhere else in `.github/workflows/`. The matrix is `shard: [0, 1, 2, 3]` with `max-parallel: 4`. `HELIO_TEST_SHARD_COUNT: ${{ strategy.job-total }}`, `HEL924_TEST_GROUP_CONCURRENCY: 2` and `HEL924_TEST_GROUP_COUNT: 4` are set, and the deadline is 660 s.
- **Glob size:** `git ls-files` over the five compile-key inputs returns 1,678 files (design says 1,671, drift since planning). There are no symlinks in `backend/src` or `backend/project`. The repo has 18,025 tracked files, and `backend/build.sbt` is the only tracked `build.sbt`.
- **durations.txt:** the Restore step takes 2-15 s on all successful legs. The three failures (44244673956 b(0), 44226053854 b(1), and 44244750573 b(3) attempt 1 per the logs) each took exactly 120 s. Leg 1 is persistently heavy: Compile-and-test was 613, 495, 491, 486, 484 and 473 s on successful runs.
- **The 660 s failure (logs/a1-44223574075/11_backend (1).txt):**
  - The sbt server started at 02:29:34.7. Test compile finished at 02:32:15.7, so compile took about **161 s**, not 150 s.
  - Tests then streamed output until the deadline at 02:40:34, about 498 s of test wall time.
  - `threads-6554.txt` shows `PatchSetUndoRepoWiringSpec.beforeAll` running (its pekko threads have elapsed=0.64 s, so the suite had just started). That is active work, not a lock wait. The D2 "not a hang" reading is supported.
- **Stale weights:** `test-suite-weights.tsv` was last touched by 1f35e5b43 (2026-10-05). It has 416 entries. About 302 of roughly 716 `*Spec` classes in `backend/src/test` have no weight. `PatchSetUndoRepoWiringSpec` is one of them. `TestShards.lpt` gives unknown suites the median weight (TestShards.scala:60-66). The D2 root cause is well grounded.
- **hel1665:437 signature:** the e2e (4) log line 2972 shows serif with `settledMax 640.001` and `ch40 600`. results.json matches. The measure code is at spec lines 474-488. D3's description is accurate.
- **Spec line numbers:** hel1583-home-375 has its test at line 25 and `expect(m.cardCount).toBe(4)` at about line 127. hel1573 has `goto` and `toBeVisible` at lines 114-115, with the existing `waitForTimeout(2500)` at line 116. Both match.
- **Ports:** `workflow-state.md` has DEV_PORT 7190 and BACKEND_PORT 10097, which match D6.

### Defects found

1. **D1's key commands do not work as written (reproduced).** `git ls-tree -r HEAD -- '*build.sbt'` and `git ls-tree -r HEAD -- 'backend/project/*.scala'` both print **nothing**: `ls-tree` does not expand glob pathspecs. `git ls-files -s -- '*build.sbt'` prints `backend/build.sbt`, and `git ls-files -s -- 'backend/project/*.scala'` prints 4 files. If implemented literally:
   - the dependency key would hash an empty set and become a constant, so it never changes when `build.sbt` changes;
   - the compile key would silently drop `backend/project/*.scala` and `*.sbt`.

   D1 marks these commands "decided". The selftest scenarios cover only the compile key, so the dependency-key half could ship constant without being caught.
2. **cache-janitor coupling not planned.** `scripts/cache-janitor.mjs:24` prunes the sbt dependency family only when the key matches `/^sbt-[0-9a-f]{64}$/`. D1 does not fix the new key's hash function or length. A git-derived 40-hex (SHA-1) value would never match, so main's `sbt-*` entries would stop being pruned. That silently breaks the `ci-actions-cache-budget` "superseded sbt dependency entry" requirement this change modifies. Neither design.md nor tasks.md mentions the janitor or its selftest.
3. **D2's fifth-leg fallback contradicts a standing owner ruling.**
   - ci.yml:212-213 says `max-parallel: 4` "documents the owner's ~4-leg cap (C6)".
   - HEL-1287's tasks.md C6 says: "backend CI capped at ~4 matrix legs; tune per-leg time inside a leg, never add legs; ... if 4 legs can't reach the target ..., escalate with measured numbers".

   D2 decides to add `shard: [0, 1, 2, 3, 4]` on its own authority. That is not this lane's call.
4. **D2's headroom test is ambiguous and under-specified.**
   - "Predicted heaviest-leg test time" from the weights has no stated conversion to wall time. Each leg splits into 4 forked groups that run 2 at a time (TestShards.groupWithinShard plus the CI env), so a summed-weight number and a wall-time number differ by about 2x. Whether the budget passes depends on which one is used.
   - The compile term is "150 s measured worst". The one measured sample is 161 s.
   - ">= 2 complete green main runs" is vacuous with the current script. `gen-test-suite-weights.py` is last-one-wins ("If a suite appears in several dirs ... the last one wins"), so the second run overwrites the first. The current header claims "mean of runs ...", which the script never computed.

### Verdict: REFUTE

### Change Requests

1. **D1 / task 1.2: compute both keys with a glob-capable git command.**
   - Use `git ls-files -s -- <pathspecs>` (the index after checkout equals HEAD), or `git ls-tree -r HEAD` over the literal directories followed by an explicit path filter. Do not use `git ls-tree` with glob pathspecs.
   - The script must fail loudly if either key's file set is empty.
   - Task 1.2's set-equality proof must compare against the real enumerated set, not a pathspec that matches nothing.
   - Add selftest scenarios to D1 and task 1.3:
     - the dependency key changes when `build.sbt` changes;
     - the dependency key is unchanged when only `backend/src` changes;
     - the compile key changes when `backend/project/*.sbt` changes.
   - Make the security job's sbt key (ci.yml:395) a decided change. That job runs the same key script in its own step; it cannot read the backend job's step output.
2. **D1 / tasks: pin the key format and plan the janitor.** Either:
   - specify that both key values are 64-char lowercase SHA-256 hex (for example `git ls-files -s ... | sha256sum`), so `cache-janitor.mjs:24` still matches; or
   - add a task updating `scripts/cache-janitor.mjs` FAMILIES and `scripts/cache-janitor.selftest.mjs`, with a red-first selftest case for the new key shape.

   Either way, add a check that the transition's orphaned old `sbt-<64hex>` entry is still pruned.
3. **D2 / task 2.3: replace "add a fifth leg" with "stop and escalate with measured numbers".** That means the per-leg prediction table and the real per-leg durations, per HEL-1287 C6, which ci.yml:212 records. The rebalance must stay at 4 legs unless the owner rules otherwise.
4. **D2 / tasks 2.2-2.3: define the headroom test exactly.**
   - **Predicted leg wall time:** pack the leg's suites into `HEL924_TEST_GROUP_COUNT`=4 groups with `TestShards.groupWithinShard`, then schedule them at concurrency 2 (or another explicitly stated model).
   - **Calibration:** check the model against the measured 44223574075 leg-1 test window (about 498 s at stale weights), or another measured leg, before it decides anything.
   - **Compile term:** use the measured 161 s (02:29:34.7 to 02:32:15.7), or the maximum over a stated sample.
   - **Combining runs:** state how the >= 2 runs are merged. Either a mean, which needs a `gen-test-suite-weights.py` change in scope with the header written by the script, or explicitly the last run with the header saying so. Do not copy forward a "mean" claim the script does not produce.

### Non-blocking notes

- D3's "the sentence has no digit" sub-hypothesis is weak: Google Fonts' latin subset normally carries digits and letters together. The forced-red-first plan already guards against a wrong hypothesis, so this is fine as written.
- Update the "1,671 tracked files" figure to the count at implementation time.
- Task 1.3 wires the new selftest into the frontend job's selftest list. Check that `check:precommit-ci-parity` accepts a new CI-only check; the existing CI-only selftests suggest it does.
