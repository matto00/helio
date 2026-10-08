## Skeptic Report — final gate (round 4, skeptic-final-2.md)

Reviewed head: `0583760653c3123e87e96e503617efe4ca40f2aa`. Base resolved live with `resolve-review-base.sh` (main/origin): `e631948dbfaea2bff361f2552fc0548f93c47f9d`. The working tree was clean (`git status --porcelain` printed 0 lines).

Owner ruling accept-partial (2026-10-08, ticket.md and profile.md) applied. The measured AC2 misses, (a) 20.5 > 15 and (c) 20.5 not below 20.0, are not grounds for this verdict.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Prior REFUTE CR1 (C2, failing-run logs), fixed:**
  - `git ls-files .../ci-logs` now lists all 7 `*-FAILED.log` files: run37703648758 attempt 1 leg 4, and run37705543644 attempts 1, 2 and 3 for legs 1 and 4.
  - Every log that profile.md cites is tracked.
  - I scanned for secrets (ghp_/ghs_/github_pat/AKIA/private key/password=/secret=/sk-ant/bearer). The only hits were false positives on `$GITHUB_PATH`.
  - `grep -ic key|token|password` returns 0 for every FAILED log, which is consistent with the README.txt redaction note.
- **Prior REFUTE CR2 (SHALL bar with no pointer to the ruling), fixed:**
  - `specs/e2e-ci-sharding/spec.md` now has a "Delivery note (HEL-1361)" under the "Balance improves" scenario. It gives 20.5 s, says (b) is met and (a)/(c) are missed, and records the owner accept-partial on 2026-10-08 and HEL-1368.
  - `e2e/README.md:103` carries the same parenthetical.
  - The numbers are unchanged, and nothing was re-measured.
- **Prior non-blocking notes, addressed:**
  - The profile.md Summary is marked HISTORICAL.
  - The selftest case is renamed to "out-of-range leg index", which matches what it actually exercises.
  - `plan` now validates its count: `plan x` and `plan 0` both exit 1 with `usage: plan <count >= 1>`. I ran both.
- **Gates, re-run fresh by me under `nice -n 19`:**
  - `npm run check:e2e-shard:selftest`: 15 cases passed, exit 0.
  - `npx eslint --max-warnings 0` on `scripts/e2e-shard.mjs` and its selftest: exit 0.
  - `prettier --check` on the changed scripts, README, package.json, ci.yml, spec.md and profile.md: clean.
  - `npm run check:precommit-ci-parity`: OK. `check:e2e-shard:selftest` is in both the hook set and the ci-complete set.
  - The configured concertino gates (frontend/backend globs) do not apply, because no `frontend/**` or `backend/**` files changed.
- **AC4 (HEL-951 contract), independently checked:**
  - I wrote a scratch script that imports only the module's exports and uses a real `npx playwright test --list`.
  - Playwright discovers 41 files. 51 `*.spec.ts` files exist on disk, and `playwright.config.ts` `testIgnore` is untouched by this diff.
  - The union of the 4 LPT legs is exactly 41 unique files.
  - `verifySelection` passes for each leg (8/11/11/11) against a real re-listing with `fileArg` filters.
  - A dropped-file mutation is rejected and the missing file is named.
  - `plan 4` gives 423/426/422/422 s weighted. The only `defaulted` file is `hel1304-output-charttype-render.spec.ts`, which matches the documented post-ruling note.
  - CI calls `node scripts/e2e-shard.mjs run <shard> <job-total>`.
  - Code review findings:
    - An empty leg is refused (`:249`).
    - A signal exit maps to non-zero (`:134`).
    - `weights` refuses incomplete or unclean runDirs (`:172`).
    - `--list` errors are surfaced (`:128`).
- **AC1:**
  - profile.md and the premise identify state-surface-contrast-guard from CI JSON artifacts.
  - It is the heaviest row in `e2e/shard-weights.tsv` at 273 s.
  - The table header names CI runDirs `37742970410-a1..a5`.
- **AC2 and AC3 numbers, recomputed from the GitHub API:**
  - Run 37748264806 is head 4b8f9f71b and has `attempt=5`.
  - Per-leg `Run e2e` step durations for attempts 1-5:
    - leg 1: 248/218/231/163/192
    - leg 2: 226/171/200/223/237
    - leg 3: 212/212/217/171/145
    - leg 4: 249/173/245/254/184
  - All 20 legs concluded success.
  - Medians are 218/223/212/245, and imbalance = 245 - 224.5 = 20.5 s. This matches profile.md exactly.
  - profile.md reports before-25, before-5 and after medians and maxima for both the leg and the step.
  - The pass/fail lines are stated plainly.
- **CI on the PR:** the run on 37becb99 (same code as this head apart from the plan-count validation, the selftest rename and docs) concluded success. CI for 05837606 was still queued when I checked.
- **Gate-defect check:** no mtime-ordering evidence was relied on.
- **UI:** this change has no UI, so step 4 was skipped.

### Verdict: CONFIRM

### Non-blocking notes

- `hel1304-output-charttype-render.spec.ts` runs on a defaulted (median) weight until the next table regeneration. This is documented.
- The README cites a path under `openspec/changes/` that will move on archive. This follows the existing README convention.
