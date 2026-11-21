## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 7b414bdd31ef0b69ae2117b1753b7152f669ff1d against live-resolved base 13180246ad2ab41bfed697e422ff419321d9df78
(`resolve-review-base.sh`, exit 0). Commits: d6b1bb7a9 (red evidence), 7b414bdd3 (implementation).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-eighth-leg/HEL-1793`.
- **Diff**: I read the full diff of ci.yml, scripts/e2e-shard.mjs, playwright.config.ts, e2e/README.md and MISTAKES.md.
  The changes are `max-parallel: 8`, `shard: [1..8]`, `DEFAULT_E2E_LEGS = 8`, and comment and doc leg-count edits.
  `timeout-minutes: 25` and `runs-on: ubuntu-24.04` are unchanged, so the owner ruling holds. No app code changed.
- **No other site keyed to the leg count**: `grep matrix.shard|job-total` over all workflows and actions found only
  per-shard artifact names, the shard-1 cache-save flags and `run ${{ matrix.shard }} ${{ strategy.job-total }}`. None
  of them hardcodes 7.
- **Guard and gates (re-run fresh by me)**: `npm run check:e2e-shard:selftest` gave "28 e2e-shard selftest cases passed",
  exit 0. `check:ci-complete-needs:selftest` gave "all passed". The task 2.3 zero-hit `git grep` exited 1 with no
  output. A wider grep for "7-leg" or "seven legs" found only the intended history text at ci.yml:619.
- **Red before green (C12)**: `git show --stat d6b1bb7a9` touches only `openspec/changes/add-eighth-e2e-leg/**`, and it
  already contains the Before table (the 1371 s figure appears in it). The mutation reds are quoted, and the evaluator
  reproduced them on the post-change tree.
- **Before measurement against ground truth (gh API, read-only)**:
  - Main CI push runs, newest first, are 44855074949 success, 44854332613 failure, 44845120888, 44840748251,
    44821653778, 44811851467 success. So the 5 used are the 5 newest green runs, and the exclusion of 44854332613 is
    real: its only failures are `e2e (4)` and `ci-complete`.
  - Per-leg job walls for 44811851467 from the jobs API (filter=latest) match the table exactly (leg 2 = 1371 s, etc.).
  - I downloaded runner records fresh. 44811851467 leg 2 is `AMD EPYC 9V74 80-Core Processor` and 44855074949 leg 7 is
    `AMD EPYC 7763 64-Core Processor`, both matching measurement.md.
- **Weights (task 3.1)**: I generated my own `--list` JSON (`DEV_PORT=7225 npx playwright test --list`, exit 0) and ran
  `weights --legs 7 --list` over the 5 runs. `cmp` against the committed `e2e/shard-weights.tsv` printed IDENTICAL,
  with 0 bytes of stderr. The inputs came from the lane's art dir, so I spot-checked them: fresh downloads of
  `playwright-json-shard-7` (44855074949) and `-3` (44811851467) are byte-identical (`cmp` SAME) to the copies used.
- **ACs**:
  1. AC1 (remedy chosen and implemented): met by the matrix, constant and docs changes above.
  2. AC2 and AC3 (>= 5 counting runs with per-leg CPU, <= 1200 s or the gap stated): these are deferred to Delivery
     task 5 by design D4/D4a, as briefed, so they are not yet evidenced. The Before half exists and is accurate.
- **Fitness of the task 5 plan and scripts** (`/home/matt/Development/helio/.concertino/runs/HEL-1793/evidence/measurement/`):
  - `capture.sh` does `mkdir -p` on its scratch dir, so a scratch sweep does not break it; a re-capture rebuilds `art/`.
  - `counting()` requires `LEGS` reports, unexpected=0 and flaky=0, plus every leg's `cpu_model:`. `measure.mjs` also
    requires LEGS `e2e (n)` jobs, every one `success`.
  - A forgotten `LEGS=8` fails loudly (no run counts), never silently.
  - Wall time is job start to completion, so queueing is excluded. The job regex `^e2e \(\d\)$` excludes `e2e-prod-build`.
  - The D4 cap and escalation rule (6 runs; fewer than 5 counting means escalate) is sound.
  - Fit to produce an honest report, with the caveats in the notes below.

### Verdict: CONFIRM

### Non-blocking notes

1. `runnerrec.mjs` cannot run as shipped. It reads `${S}/testmed.json`, which exists in neither the HEL-1793 scratch dir
   nor either evidence dir, and no script generates it. If an after run has a leg over 1200 s, compute the "leg factor"
   the spec scenario requires by design D4's definition (that leg's wall over the mean of the run's other legs, from
   `measure.mjs` output). Say which definition was used; do not cite runnerrec.
2. On a C11 rerun, `capture.sh` reads jobs with `filter=latest`, but `gh run download` is not attempt-scoped. Before
   counting a rerun, confirm that the downloaded reports and runner records belong to the clean attempt, for example
   by checking the artifact `created_at` against the attempt's job times.
3. The ci.yml:619 comment says "7-leg main runs still had a slowest leg of 1312-1371 s on older host CPUs (AMD EPYC
   7763 at 1.4x)". The 1371 s leg (44811851467 leg 2) ran on an AMD EPYC 9V74, which is not an older host. Reword it
   ("mostly AMD EPYC 7763") when measurement.md is next edited at Delivery. That 9V74 outlier is not explained by the
   CPU; if it recurs in an after run, state a different cause.
4. Design D4 says the Before section cites HEL-1789's 5 PR runs, but measurement.md does not. Add a one-line citation
   or drop the clause (the evaluator noted this too).
5. Three spec weights (hel1791 and both HEL-1649 narrow specs) rest on one run. This is disclosed. Regenerate once more
   counting main runs exist.
6. "backend 4 + e2e 8 = 12 parallel jobs" omits the separate `e2e-prod-build` job. The omission predates this change
   (it said 11 before), so it is not a regression.
