## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 497e2b32143a5da2b56f197dff1817195a5904a3. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/flake-sweep-two-ci/HEL-1758`.

- **Round-3 CR1 (the after-check could not pass and could not detect a wrong key): addressed.** D1 (d) now requires all of the following:
  - (i) For every consumer, the resolved key string from that job's log, matched against `^sbt-[0-9a-f]{64}$` or `^backend-compile-v3-Linux-[0-9a-f]{64}$`. A bare prefix is called out explicitly.
  - (ii) `deps` is identical across jobs.
  - (iii) The expected PR outcome is stated as a prefix hit.
  - (iv) An exact hit is a post-merge observation only.
  - It also adds an in-step `^[0-9a-f]{64}$` assertion before outputs are written, and placement "before the FIRST cache step".

  Task 1.5 mirrors this. The round-3 non-blocking notes on step placement and composite `shell: bash` were also taken up.

- **Key-site inventory (re-derived):** `grep -rn "hashFiles" .github/` returns:
  - ci.yml:255, 280, 331, 341 and 395;
  - e2e-setup/action.yml:49 and :74.

  D1 changes the first six and correctly leaves :74 (two literal lockfile paths) alone. `grep -rn "sbt-\|backend-compile" .github/` shows no other cache consumer.

- **No static checker pins the old key text:** `grep -rln "hashFiles|backend-compile-v3" scripts/ e2e/ backend/project docs` hits only `cache-janitor.mjs` and its selftest.
  - The janitor families are `/^sbt-[0-9a-f]{64}$/` (keep 1) and `/^backend-compile-v3-Linux-/` (keep 2).
  - Both are consistent with D1's 64-hex format decision.
  - The living spec `ci-actions-cache-budget` scenario at :61 speaks of `sbt-<hash>`, so the format is preserved.

- **Checkouts and composite:**
  - The ci.yml composite uses are at :655 and :760.
  - e2e-slow.yml checks out at :61, then calls the composite at :62.
  - e2e-slow's path filter at :15 includes `.github/actions/e2e-setup/**`, as D1 says.
  - There is no sparse checkout and no `defaults:` override in ci.yml.

- **Selftest wiring precedent:**
  - ci.yml:153-160 already runs CI-only selftests, including the bash `selftest:e2e-backend-lane`, which uses a throwaway git repo.
  - The comment at :153-154 states that `check:precommit-ci-parity` only requires hook checks to appear in CI, not the reverse.

  So the plan's wiring and parity check are feasible as written.

- **D2 premises:**
  - `gen-test-suite-weights.py:13-17` is last-one-wins (`weights[name] = time + 1.0`) while the tsv header claims "mean of runs 37391616534 and 37400422292". The planned failing-first check is real.
  - The tsv was last touched in 1f35e5b43 (HEL-1287, 2026-10-05) and has 416 suites.
  - About 604 test files define a Spec/Test/Suite class today.
  - `build.sbt:221-248` loads the tsv, shards with `TestShards`, then calls `groupWithinShard(mine, weights, groupCount)`.
  - ci.yml sets `HEL924_TEST_GROUP_COUNT: 4` and `HEL924_TEST_GROUP_CONCURRENCY: 2`.

  The wall-time model's inputs exist as described.

- **Leg cap:** ci.yml:212-216 still has `max-parallel: 4` and `shard: [0, 1, 2, 3]`. C16 and D2's escalate-not-add path are consistent with the owner's cap.

- **e2e premises:**
  - **hel1665:437–:480.** The test's order is: `fonts.ready`, then a poll that the rendered face is the web face, then a poll on `document.fonts.status === "loaded"`, then set `maxWidth = "40ch"` and read it back synchronously. This matches D3's description.
  - **hel1583-home-375:25.** This is the loop test. `expect(m.cardCount).toBe(4)` follows the measure, as D4 says.
  - **hel1573:113-115.** The sequence is `goto("/dashboards")`, then `toBeVisible()` on `.chart-panel__canvas canvas`, then the pre-existing `waitForTimeout(2500)`. This matches D5.

- **Planning evidence exists in the main-checkout scratch:**
  - `logs/a1-44223574075/`, `logs/a1-44226053854/` and `logs/a1-44244750573/`;
  - `artifacts/r44223574075-sbtdiag1/threads-6554.txt` and `threads-2658.txt`, plus `sbt.log`;
  - three Playwright artifact dirs and `durations.txt`;
  - `grep -rl "couldn't finish within 120"` hits backend (1) of 44226053854 and backend (3) of 44244750573.

- **AC coverage:**
  - Backend hashFiles root cause, fix and before/after timings: D1 and tasks 1.1-1.5.
  - The 660 s verdict and action: D2 and tasks 2.1-2.4.
  - Each e2e candidate, forced red then 40/40: D3-D6 and tasks 3-5.
  - The HEL-1757 fold decision: D3 and task 3.1.
  - No placeholders, no TBDs and no internal contradictions found.
  - Scope stays within the ACs, and C15 and task 6.1 guard the concurrent lanes.

### Verdict: CONFIRM

### Non-blocking notes

- **D1 (d)(ii) reference commit.** The CI key is computed at the PR merge commit, and D1 itself has the step print `git rev-parse HEAD` for this reason. (ii) compares `deps` with the script's output "at the PR head commit".
  - Today `backend/build.sbt` is unchanged between the branch point and origin/main.
  - origin/main 374741b68 (HEL-1742) has already changed 28 files under `backend/src`.

  So the compile keys differ between the merge commit and the PR head. Compare both `deps` and `compile` against the script run locally at the commit the CI step printed, for example `git fetch origin refs/pull/<N>/merge`. A local `compile` comparison also catches a wiring slip where the compile key is fed `outputs.deps`, which the regex and cross-leg identity checks would not catch.
- **D3/D4 have no failed-to-reproduce fallback; D5 has one.**
  - The AC permits "record the probes that failed to reproduce it" for every candidate.
  - If D3's font hypothesis or D4's shelf-data hypothesis does not reproduce with the CI signature, record the probes and keep the spec a named candidate, as D5 does. Do not engineer a forcing that does not match the CI signature.
  - D3's requirement that the red reproduce the exact signature (rendered face Fraunces, `ch40` = the fallback width) already rules out the trivial "block all Fraunces" forcing, which fails the face precondition first.
- **D4 fix shape:** waiting for exactly four `.home-shelf__item` and then asserting `cardCount` is 4 makes that one assertion tautological. The layout assertions (gutter, timeline position) are what the test is for, so this is acceptable. Prefer waiting on the shelf's settled state if one exists.
- **D3 hypothesis strength:** Google Fonts' `latin` subset normally carries both letters and digits. So "the `0` subset was never requested" is weaker than "a different weight/style face (the element's computed font) was not yet loaded". The trace will decide. D3 already labels it a leading hypothesis.
- **Living spec `backend-ci-test-execution`, "Backend CI timing is profiled from CI logs" (:44-51), requires that "the change that alters backend CI execution" carry a before/after profile, including a test-count reconciliation.**
  - This change repartitions suites. Including the per-shard test counts before and after, with sums equal, is cheap and shows that no suite was lost.
  - The runtime partition check already fails a leg on a missing suite, so this is belt-and-braces.
- **The spec delta covers only the compile key.** The dependency-key change in D1 has no spec scenario. Optionally add one: the `sbt-` key is a 64-hex value computed without a workspace walk.
