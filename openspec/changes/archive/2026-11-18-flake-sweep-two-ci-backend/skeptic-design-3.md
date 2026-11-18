## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 497e2b32143a5da2b56f197dff1817195a5904a3. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/flake-sweep-two-ci/HEL-1758`.
- **Round-2 CR1 (e2e-setup consumer): addressed.**
  - `grep -rn "hashFiles" .github/` returns exactly these sites:
    - ci.yml:255, 280, 331, 341 and 395;
    - e2e-setup/action.yml:49 (`sbt-${{ hashFiles('**/build.sbt') }}`);
    - e2e-setup/action.yml:74, which hashes two literal lockfile paths.
  - D1 "Uses" and task 1.4 now cover all six key sites, and the plan correctly leaves :74 alone.
  - The plan notes the e2e-slow path trigger.
- **Pathspecs:**
  - `git ls-files -s -- ':(glob)**/build.sbt'` prints only `backend/build.sbt`.
  - The five compile pathspecs match 1,678 tracked files, which matches D1's figure.
  - `backend/project` tracks `gen-test-suite-weights.py` and `test-suite-weights.tsv`. Neither is in the compile key's pathspec set, under either the old or the new key.
- **Checkout:** every checkout is a plain `actions/checkout@v7`, with no sparse-checkout setting (ci.yml:240, 379, 654, 759). The security job (ci.yml:379-395) only restores the sbt cache, so its own `backend-key` step is the right shape.
- **Leg cap:** ci.yml:212-216 still has `max-parallel: 4` and `shard: [0, 1, 2, 3]`, with the owner's ~4-leg cap comment. C16 and D2's "stop and escalate" are consistent with it.
- **D2 premises:**
  - The tsv header claims "mean of runs 37391616534 and 37400422292".
  - The tsv was last touched by HEL-1287 on 2026-10-05.
  - `TestShards.scala` has `medianWeight` (:53), `lpt` (:64) and `groupWithinShard` (:104), so the wall-time model's building blocks exist.
- **D5 premise:** hel1573-motion-grid-chart.spec.ts:113-115 runs `goto("/dashboards")`, then `toBeVisible()` on `.chart-panel__canvas canvas`, then the pre-existing `waitForTimeout(2500)`. This matches D5.
- **Selftest wiring:** package.json already has CI-only selftests, for example `selftest:ci-sbt` (run in backend shard 0, ci.yml) and `selftest:cache-janitor`. A new one has existing precedent, and the plan's parity check is planned.
- **The "before" sbt-restore outcome, from attempt-1 logs** (scratch `logs/a1-44223574075/`): every consumer had an EXACT hit, `Cache hit for: sbt-dd4a12d2...0818`:
  - `2_e2e (1).txt` at 02:29:49;
  - `6_e2e-prod-build.txt` at 02:29:42;
  - `14_security.txt` at 02:29:27;
  - `1_backend (0).txt` at 02:29:22.

  This is where I found the defect below.

### Verdict: REFUTE

### Change Requests

1. **D1 (d) / task 1.5: the "after" acceptance check cannot be met on the PR run, and it cannot detect a wrong key.**

   **The check cannot pass.** D1 (d) requires: "For an e2e leg, `e2e-prod-build` and `e2e-slow`, the `sbt-` restore outcome must be an exact hit or the same hit/prefix outcome as before." The "before" outcome is an exact hit in every job (log lines above). After this change:
   - the PR computes `sbt-<sha256 of git ls-files -s>`;
   - the cache holds only main's hashFiles-era `sbt-dd4a...`;
   - PRs never save (ci.yml:339, main push only).

   So every PR-run restore is necessarily a prefix hit through `restore-keys: sbt-`. That is neither an exact hit nor the "same outcome as before". The same holds for the backend legs' and the security job's dependency restores. The criterion is unsatisfiable by construction, and an executor will either stall or rationalise past it.

   **The check cannot tell a correct key from a broken one.** The likely wiring defects are a step placed after its consumer, a misspelled `steps.backend-key` id, or a missing step in the composite or the security job. In GitHub Actions, a reference to a step output that does not exist evaluates to an empty string, with no error. The key then becomes the bare `sbt-` or `backend-compile-v3-Linux-`. That bare key also prefix-hits, so it looks exactly like the correct transition outcome. On a main push it would then:
   - SAVE an entry literally named `sbt-`;
   - leave that entry unprunable, because the janitor's `/^sbt-[0-9a-f]{64}$/` does not match it;
   - get it exact-hit by every later run, regardless of `build.sbt` changes.

   The script's own empty-input-set guard does not cover this, because the script never runs or is never read.

   **Required.** Rewrite the D1 (d) "after" criterion, and task 1.5, so that:
   - (i) for every consumer in the PR run, the PR body cites the RESOLVED key string from that job's log. The consumers are the four backend legs (deps + compile), security, at least one e2e leg, `e2e-prod-build` and `e2e-slow`. Each key must match `^sbt-[0-9a-f]{64}$` or `^backend-compile-v3-Linux-[0-9a-f]{64}$`, never a bare prefix.
   - (ii) the `deps` value is identical across all those jobs, and equals what the script prints locally at the PR head commit (`git ls-files -s -- ':(glob)**/build.sbt' | sha256sum`).
   - (iii) the expected PR-run outcome is stated as a prefix hit (`Cache hit for restore-key: sbt-...` / `backend-compile-v3-Linux-...`), not "exact or same as before".
   - (iv) the exact-hit expectation is stated as post-merge only: the first main push saves the new key, and a later run exact-hits it. That is a follow-up observation to record if available, not a PR-gate criterion.

   Optionally, and cheaper still, each consuming step could fail fast on an empty output, for example a `run` guard or a key-format assertion in the `backend-key` step itself plus a reference check. That is non-blocking if (i) and (ii) are in place.

### Non-blocking notes

- **Step placement:** D1 says "a new step before the restore". In the backend job it must precede the dependency restore at ci.yml:249-256, not only the compile restore at :274, because both consume it. Say "before the first cache step" to remove the two readings. CR1 (i) would catch a misplacement either way.
- **Composite `run` steps** need an explicit `shell: bash` (implementation detail; it fails loudly if missing).
- **Old janitor regex:** the old compile entries `backend-compile-v3-Linux-<64hex>` stay prefix-restorable. The family is prefix-matched, so the transition is fine, as the design says.
- **The round-2 notes were taken up:** the `':(glob)**/build.sbt'` tightening, the key step's duration beside Restore, and the calibration wording.
