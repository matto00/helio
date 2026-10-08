## Skeptic Report — final gate (round 3, skeptic-final-1.md)

Reviewed head: `37becb99b4df683403647c7191b3280737885063`. Base resolved live with `resolve-review-base.sh`: `e631948db`.
Owner ruling accept-partial (ticket.md, profile.md) applied. The measured misses on AC2 (a) and (c) are NOT grounds for this verdict.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Gates, re-run fresh by me under `nice -n 19`:**
  - `npm run check:e2e-shard:selftest`: 15/15 passed.
  - `npx eslint --max-warnings 0` on both scripts: exit 0.
  - `prettier --check` on the changed files: clean.
  - `check:precommit-ci-parity`: OK. `check:e2e-shard:selftest` is in both the hook and the CI-covered set.
- **Tooling correctness (AC4, HEL-951):**
  - `DEV_PORT=6793 node scripts/e2e-shard.mjs plan 4` exits 0. It assigns 8/11/11/11 files, weighted 423/426/422/422 s. The only `defaulted` file is `hel1304-output-charttype-render.spec.ts`, which matches the documented post-ruling note.
  - Independent scratch check, using only the module's exports and real `playwright test --list`: 41 files discovered, the union of the 4 legs is exactly those 41, and `verifySelection` passes for every leg against a real re-listing.
  - The CI step at `ci.yml:575` calls `node scripts/e2e-shard.mjs run <shard> <job-total>`.
  - Code review of `scripts/e2e-shard.mjs`:
    - Deterministic LPT.
    - Exact-once checks and empty-leg refusal (`:249`).
    - Signal exits map to non-zero (`:134`).
    - `weights` refuses incomplete or unclean runDirs (`:172`).
- **C1 (weights from CI only):** the `e2e/shard-weights.tsv` header names runDirs `37742970410-a1..a5`. It has 40 rows and no `hel1304` row, so nothing was hand-added. `git log` shows only two generator commits.
- **C4 (fixed after set, no substitution):**
  - GitHub API: run 37748264806 has `run_attempt=5`, which is exactly 5 attempts with no 6th.
  - It is the only CI run on head 4b8f9f71b.
  - Per-leg `Run e2e` step seconds for attempts 1-5 match profile.md exactly:
    - leg 1: 248/218/231/163/192
    - leg 2: 226/171/200/223/237
    - leg 3: 212/212/217/171/145
    - leg 4: 249/173/245/254/184
  - All 20 legs concluded success. Imbalance: 245 - 224.5 = 20.5 s.
- **Control honesty (D8):**
  - I listed every ci.yml run created 07:30-09:00Z on 2026-10-08.
  - In the window (08:12:04..08:47:16) are 37749098184, 37750186857, 37750313498 and 37751642593. The last is a main run that failed, and profile.md records it as excluded.
  - The backward extension to 37748221338 and 37744958037 is the next two runs by start time.
  - No run was left out or selected as a subset.
- **AC1:** state-surface-contrast-guard is identified from CI JSON evidence (premise and profile). Met.
- **AC3:** profile.md reports before-25, before-5 and after per-leg medians and maxima (leg and step), with run ids. Met.
- **AC2:** measured and honestly reported with pass/fail lines. Accepted as partial by the owner ruling.

### Verdict: REFUTE

Neither defect is the accepted AC2 miss. Both are integrity defects in what this change ships.

### Change Requests

1. **C2 violated: 7 failing-run logs cited by profile.md are not committed.**
   - profile.md (section "Post-merge measurement") cites:
     - `ci-logs/run37703648758-attempt1-e2e4-FAILED.log`
     - `ci-logs/run37705543644-attempt{1,2,3}-e2e{1,4}-FAILED.log`
   - None of those 7 files is tracked. `git ls-files .../ci-logs` lists only README.txt and the three `run37676655366-*` logs.
   - `git check-ignore -v` shows all 7 are ignored by `.gitignore:27:*.log`. The earlier three were force-added; these were not.
   - They exist only in this worktree and will be lost at `cleanup.sh --phase4`. That leaves dangling citations, and C2 ("keep full logs for any failing run") becomes false.
   - My scan for secret, password, token, api-key and ghp_/ghs_ patterns found nothing in them.
   - **Fix:** `git add -f` the 7 `*-FAILED.log` files and commit.
2. **The spec delta and README state the balance bar as SHALL with no pointer to the accept-partial ruling.**
   - The orchestrator's brief asked me to check exactly this. It fails.
   - `specs/e2e-ci-sharding/spec.md`, Requirement "e2e shard balance is measured in CI" and Scenario "Balance improves", require an after imbalance of at most 15 s and below the control. `e2e/README.md:103` repeats it as the "Acceptance bar for any change to shard assignment (e2e-ci-sharding spec, SHALL)".
   - The change that introduces this requirement measurably misses (a) (20.5 > 15) and (c) (20.5 is not below 20.0).
   - Neither file mentions the miss, the owner's accept-partial ruling (2026-10-08) or HEL-1368. The README only points to the change's `profile.md`, and that path moves on archive.
   - Once archived to `openspec/specs/`, a reader will take the requirement as satisfied by its originating change.
   - **Fix:** add one short note to both the spec requirement (non-normative text under the requirement, or a note in the scenario) and the README sentence. It should say that HEL-1361, which introduced the bar, measured 20.5 s (meets (b), misses (a) and (c)), that the owner accepted this as partial on 2026-10-08, and that the residual drift is HEL-1368.
   - Do not change the numbers or re-measure.

### Non-blocking notes

- The `profile.md` top "Summary" describes run 37676655366 and an old "<= ~390 s whole-leg" bar. Mark it historical and superseded by "Final measurement (task 3.4)".
- `scripts/e2e-shard.selftest.mjs`: the case "empty shard: CLI refuses..." exercises the `index > count` usage guard, not the `mine.length === 0` refusal at `scripts/e2e-shard.mjs:249`. Rename it or test the real guard.
- `plan` mode does not validate `<count>` (`plan x` gives NaN legs). The CI path (`run`) does validate it.
- The README cites a path under `openspec/changes/` that will dangle after archive. Existing README entries (lines 21/55/68) follow the same convention, so this is informational only.
- Gate-defect check: no mtime-ordering evidence was relied on. Report authentication uses the `stats.startTime` content of the reports.
