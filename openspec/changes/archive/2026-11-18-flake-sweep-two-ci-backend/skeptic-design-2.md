## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 497e2b32143a5da2b56f197dff1817195a5904a3. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/flake-sweep-two-ci/HEL-1758`.
- **Round-1 CR1 (glob-capable key command): addressed.**
  - D1 now specifies `git ls-files -s -- <pathspecs> | sha256sum` and forbids `ls-tree` with globs.
  - I re-ran the commands. `git ls-files -s -- '*build.sbt' '**/build.sbt'` prints `backend/build.sbt`.
  - The five compile pathspecs match 1,678 tracked files.
  - The selftest list now covers the dependency key (changes on build.sbt, unchanged on src), project `*.sbt`, the 64-hex format and the empty-set failure.
  - Red is planned against both broken variants.
- **Round-1 CR2 (janitor): addressed.**
  - `scripts/cache-janitor.mjs:24` has `{ name: "sbt-deps", re: /^sbt-[0-9a-f]{64}$/, keep: 1 }`, and `selectDeletions` keeps the newest by `created_at` on `refs/heads/main`.
  - The planned `sha256sum` output (64 lowercase hex) stays in the family, so the old hashFiles-era entry is pruned as superseded.
  - A janitor selftest case is planned with a 40-hex mutation.
- **Round-1 CR3 (no fifth leg): addressed.** D2 says "stop and escalate". C16 records it, and ci.yml:212-216 still shows `max-parallel: 4` and `shard: [0, 1, 2, 3]`.
- **Round-1 CR4 (headroom test): addressed.**
  - The model is defined as `groupWithinShard` into 4 groups, then LPT onto 2 slots. Both `TestShards.groupWithinShard` (TestShards.scala:104-109) and `lpt` (:64) exist.
  - Calibration has a >= 498 s floor and a 20 % error bound.
  - The compile term is 161 s and the budget is <= 480 s.
  - The mean-of-runs change to `gen-test-suite-weights.py` is in scope. Its docstring today says "the last one wins", while the tsv header claims "mean of runs 37391616534 and 37400422292". The failing-first check is aimed at exactly that mismatch.
- **hashFiles failure signature:** the attempt-1 logs (`logs/a1-44226053854/8_backend (1).txt`, `logs/a1-44244750573/7_backend (3).txt`) both read `ci.yml (Line: 280, Col: 16): hashFiles('backend/src/**, ...') couldn't finish within 120 seconds`. That is runner-side expression evaluation, as D1 states.
- **hel1583-home-375:** spec line 25 is inside the test loop; the test waits on `timeline` toBeVisible at line 61; cards are queried as `.home-shelf__item` (line 77); the assertion is at line 127. This supports D4's hypothesis that the measure waits on the timeline, not on the cards.
- **hel1665:437:** the measure sequence is `fonts.ready` (468), `fonts.status === "loaded"` poll (476), then `maxWidth = "40ch"` (483). This matches D3.
- **Ground-truth search for every sbt dependency-cache key site:** this is where I found the defect below. `grep -rn "hashFiles\|key: sbt" .github/` finds more sites than ci.yml's five.

### Verdict: REFUTE

### Change Requests

1. **D1 / task 1.4 miss a third consumer of the same `sbt-` dependency key: `.github/actions/e2e-setup/action.yml:49`.**

   That line has `key: sbt-${{ hashFiles('**/build.sbt') }}` with `restore-keys: sbt-`. The composite action is used by ci.yml `e2e` (6 legs, ci.yml:655), ci.yml `e2e-prod-build` (ci.yml:760) and `e2e-slow.yml:62`. D1's inventory covers only ci.yml:255/280/331/341/395. It makes a decision only for the security job, on the stated reasoning that every restorer must compute the same key as the one saver (backend shard 0, ci.yml:341). As planned:

   - **The key family splits.** After the change, main saves `sbt-<sha256 of ls-files>`. The e2e jobs still request `sbt-<hashFiles value>`. That entry is pruned by the janitor as superseded (keep: 1), so the e2e jobs' exact key never exists again. Every e2e/e2e-prod-build/e2e-slow job silently degrades to a prefix-only restore (`cache-hit` false) forever. Nothing in the plan detects this.
   - **The failure class survives in 8 jobs per CI run.** D1 itself says the `**/build.sbt` expression "walks the WHOLE workspace (18,025 tracked files), the same failure class". The plan leaves exactly that expression in the e2e jobs, which are also the jobs whose flakes this ticket targets.

   **Required:**

   - Add `.github/actions/e2e-setup/action.yml` to D1's "Uses (decided)". Add a step inside the composite action, before its sbt restore, that runs `scripts/ci-backend-cache-key.sh`, and use its `deps` output. Composite actions can read their own steps' outputs. The composite runs after the caller's checkout, so the index is available.
   - Add the site to task 1.4.
   - Add to D1 (d) an "after" check that an e2e leg and e2e-prod-build get an exact `sbt-` hit, or the same hit/prefix outcome they had before.
   - Note in the plan that touching `.github/actions/e2e-setup/**` triggers `e2e-slow.yml` on the PR (its path filter at e2e-slow.yml:15). Those results are part of this PR's CI evidence.
   - Before finalizing the inventory, re-derive it with `grep -rn "hashFiles" .github/`, not `.github/workflows/` only. The round-1 inventory searched only `workflows/`.

### Non-blocking notes

- **D1 (d) after-table:** the key computation moves from the Restore step into the new `backend-key` step. Report that step's duration beside the Restore step's, per leg. Otherwise the "after" Restore timing hides where the work went. It will be sub-second, but say so with the number.
- **Pathspec semantics:** `*build.sbt` also matches a hypothetical `foo/xbuild.sbt`, which `hashFiles('**/build.sbt')` would not. `':(glob)**/build.sbt'` matches top-level and nested `build.sbt` exactly (verified: it prints `backend/build.sbt`). Today the sets are equal, and D1 (c)'s set-equality check would catch a divergence. Optional tightening.
- **D2 calibration wording:** "Calibrate ... with the OLD weights and partition" should read "the OLD partition (from the old weights) and the newly measured per-suite durations". Prediction against reality needs measured durations. Note also the weights script's docstring: JUnit `time` excludes beforeAll/afterAll, and Flyway migrations live there, so the +1.0 s flat setup term may be what the 20 % gate trips on. That is fine; the uncalibrated path is defined.
- **D4:** the card selector is `.home-shelf__item`, not `.home-shelf`. D4 phrases its selector as an example only, so this is harmless.
- **tasks.md:** C16 is listed before C15 in Standing Constraints. Cosmetic.
