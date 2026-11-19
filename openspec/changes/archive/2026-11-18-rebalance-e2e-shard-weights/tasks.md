## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Only scripts may read scripts/concertino/.concertino.env, and it is never printed.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull, never bare sbt test.
- [C6] Measure from real CI run data only (gh api / gh run view / CI artifacts), never local Playwright timings.
- [C7] Do not touch release/CD workflows (cd-*.yml), HEL-1743's or HEL-1732's files. No `timeout-minutes` change and no partition-logic change in e2e-shard.mjs; the matrix / max-parallel / `DEFAULT_E2E_LEGS` change is section 2b's, per the owner ruling of 2026-11-18.
- [C8] Scratch in .concertino/scratch/HEL-1772/ (main checkout); never commit scratch.
- [C9] Known flakes (C11): hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104, candidate hel1656-pull-to-refresh:340. An unlisted unrelated CI failure gets ONE literal `gh run rerun --job <id>`, named in the PR.

## 1. Regenerate the weights

- [x] 1.1 Pick the source runs: the 5 most recent main push CI runs where all 6 e2e legs succeeded; include run 44403971270 (base head 80cab1f7a) if it is green. Download `playwright-json-shard-*` per run into `.concertino/scratch/HEL-1772/art/<runId>/`. Verify: `weights` mode accepts all 5 (it rejects a run with missing/flaky/unexpected reports).
- [x] 1.2 `node scripts/e2e-shard.mjs weights <runDir>... > e2e/shard-weights.tsv`. Verify: `node scripts/e2e-shard.mjs plan` lists zero defaulted specs and zero stale rows (or names any stale row and why), and `npm run check:e2e-shard:selftest` passes.
- [x] 1.3 Red-first proof of the cause: compute, for the OLD table and the NEW table, each leg's predicted summed load from real per-file durations (partition with table X, then sum real durations per leg), both in-sample (the source runs) and out-of-sample (at least one counting main run NOT in the source set: 44403971270 if unused, else 44328417748 or 44325353598). Verify: OLD gives a max/mean leg ratio clearly above NEW on both; record both in `.concertino/scratch/HEL-1772/balance.md` and in the PR. Mutation: restore one heavy row (e.g. hel1733) to absent and show the imbalance return.

## 2. Comment and record

- [x] 2.1 Update the e2e job's measured-wall comment in `.github/workflows/ci.yml` to name HEL-1772, the cause, and the before figures (comment only). Verify: `git diff` of ci.yml touches only comment lines.

## 2b. Fold-in: 7 e2e legs (owner ruling 2026-11-18)

- [x] 2b.1 Red first: in `.github/workflows/ci.yml` change only the e2e matrix to `shard: [1, 2, 3, 4, 5, 6, 7]` and run `npm run check:e2e-shard:selftest`. Verify it FAILS, naming the leg-count mismatch. Record the output.
- [x] 2b.2 Set `DEFAULT_E2E_LEGS = 7` in `scripts/e2e-shard.mjs` (and its comment), set `max-parallel: 7`, and update the ci.yml e2e comments to the 7-leg ruling with the measured 6-leg PR figures (design.md Decision 4). Verify: the selftest passes; `node scripts/e2e-shard.mjs plan` shows 7 legs, zero defaulted specs, every spec exactly once; the ci.yml diff touches only the e2e job.
- [x] 2b.3 Update `scripts/e2e-shard.selftest.mjs` so the default-path fixtures derive from `EXPECTED_SHARD_REPORTS` instead of `six()` and the literal "expected exactly 6" (the default-count cases; the over-count case stays one more than the default and the under-count case one fewer; the explicit `--legs 4 ... refuses 5-of-6` case may keep its 6). Give the drift `assert.equal` (default leg count vs ci.yml matrix length) a message naming the mismatch. Verify the guard both ways and record both outputs: (a) matrix-only change fails at the drift assertion; (b) after the fixture rewrite, a `DEFAULT_E2E_LEGS`-only change fails at the drift assertion, not at a fixture. Every RED case must still be able to fail.
- [x] 2b.4 Update the leg-count statements in `playwright.config.ts` (workers comment), `e2e/README.md` (including that a regeneration from 6-leg runs needs `weights --legs 6`), and `MISTAKES.md:211` (the "~8 legs ... never add legs" cap statement) to the current rulings (HEL-1698: 6 legs; HEL-1772: 7 legs, backend 4 + e2e 7 = 11 parallel jobs). Verify with a grep for "6 legs", "six legs", "~8 legs", "never add legs", "4 + e2e 6" and "backend 4 + e2e" that no file outside `openspec/changes/archive/` states a stale e2e leg count or cap (historical HEL-1698 notes keep their context but say they were superseded).

## 3. CI proof (Delivery phase, orchestrator-owned, after PR creation; not executor work; after the fold-in: at least 3 attempts at 7 legs per design.md Decision 5)

CI runs only on `pull_request` and main pushes, so the after measurement exists only once the PR is open. Per design.md Decision 3, the orchestrator, after Phase 3 creates the PR:

- Before set: the 25 most recent counting main push runs (excluded runs listed with reason). Per leg median and max of job wall and "Run e2e suite" step; imbalance (slowest leg median test step minus mean of leg medians).
- After set (7 legs, per design.md Decision 5): whole-run measurement attempts of the PR's final head until 5 counting attempts or 7 attempts in total, whichever comes first, and never fewer than 3 attempts (first run plus whole-run `gh run rerun <runId>` so all legs run together, comparable with the before set; named in the PR as measurement reruns; artifacts matched to their attempt so every report is checked per attempt), per-attempt via `/attempts/{n}/jobs`. Same figures plus each run's mean leg. Target: slowest leg at or under 1200 s job wall on normal runs; headroom under 1500 s stated per run. If exceeded, report the table and cause; never raise the limit.
- PR body: the specs weighted from only 1-4 source runs, and any spec changed after the source runs (e.g. hel1608), listed; the 15 s line called a gap this change still carries, with the measured number;
- PR body: before/after tables, imbalance before/after against the 15 s line, the not-applicable control set (a) and the HEL-1361 accepted 15 s gap (b), the new-spec placement rule (HEL-1743), and the post-merge main watch status for the 20-minute requirement.
