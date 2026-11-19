## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: ab88ede88981f9111948b6ffccea574197e01603. Base (resolved live): 80cab1f7aa5559bafc3826cd9072b68ba651c195.
Scope: tasks.md sections 1-2. Section 3 (the after measurement on CI runs of the PR) belongs to the orchestrator at Delivery. It is not expected yet and is not counted against this cycle.

Diff: `e2e/shard-weights.tsv` (data), 4 added comment lines in `.github/workflows/ci.yml`, and the OpenSpec change dir. Nothing else changed.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (measure and name the cause): design.md Context measures per-leg job wall on 11 main runs and summed per-test load on 5 clean runs. It names the cause as a stale weight table and explains why a too-tight limit or a single slow spec was ruled out. I checked the key figures independently (see Phase 2).
- AC2 (fix the cause): the table was regenerated with the existing tool. The tool's logic, the leg count and `timeout-minutes` are unchanged.
- AC3 (per-shard times on at least 3 CI runs): this is tasks.md section 3, owned by the orchestrator after the PR exists. It is out of scope for this cycle.
- Tasks 1.1, 1.2, 1.3 and 2.1 are checked, and each matches what was done (details below).
- Workflow-state CONSTRAINTS C1-C9 are all honored. In particular, C7 holds: no `cd-*.yml` file, no HEL-1743 or HEL-1732 file, no `timeout-minutes` or matrix change, and no `e2e-shard.mjs` change. Scratch files are not committed (C8).
- `skip_specs: true` is justified: the existing `e2e-ci-sharding` requirements already describe the intended behavior.

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh evidence (every item run by me, not taken from the executor):
- **The table is byte-identical to a fresh regeneration.** I ran `node scripts/e2e-shard.mjs weights` over `.concertino/scratch/HEL-1772/art/{44391395102,44375091328,44357733862,44353873500,44350387897}` and compared the output to `e2e/shard-weights.tsv` with `cmp`: IDENTICAL, rc=0. The tool's run validation accepted all 5 runs.
- **The local artifacts match GitHub.** I re-downloaded `playwright-json-shard-6` of run 44357733862 and `playwright-json-shard-2` of run 44391395102 with `gh run download`. `diff -r` against the scratch copies shows no difference.
- **The source runs were chosen correctly.** I checked this against the GitHub API (`ci.yml` runs, main branch, push events):
  - All 5 runs completed with success, on attempt 1, with all six e2e legs succeeding.
  - They are the 5 most recent such runs. 44369179186 is cancelled.
  - Base-head run 44403971270 is still `in_progress` (e2e (6) has not finished), so leaving it out was correct.
- **`plan` lists zero defaulted specs and zero stale rows.** Running `node scripts/e2e-shard.mjs plan` prints neither a "defaulted (no weight row)" line nor a "stale weight rows" line. Planned leg weights are 1615-1619 s.
- **The selftest passes.** `npm run check:e2e-shard:selftest`: 18 cases passed, rc=0.
- **The `ci.yml` diff is comment-only.** Every added or removed line in the diff starts with `#`, and `timeout-minutes: 25` is untouched. `npx prettier --check .github/workflows/ci.yml` and `npm run format:check` both pass.
- **The `ci.yml` figures match the GitHub API.** I fetched e2e job `completed_at - started_at` for all 11 runs. The result matches `main-leg-times.tsv` exactly. From the API:
  - The slowest leg per run ranges from 1122 to 1519 s.
  - e2e (6) is the slowest leg in 6 of 11 runs.
  - e2e (4) hits 1377, 1396 and 1443 s (3 times at 1377 s or more).
  - One run was cancelled at 1519 s.
  - The new table's weights are hel1733 = 358 s and hel1684 = 334 s, which supports "about 340 s".
- **The balance proof is correct.**
  - `old-weights.tsv` is byte-identical to the base `e2e/shard-weights.tsv` (`git show 80cab1f7a:e2e/shard-weights.tsv | cmp`).
  - Re-running `balance.mjs` (in-sample over the 5 runs, out-of-sample over 44328417748) reproduces every line of `balance.md` exactly.
  - **The model is checked against reality.** I summed each run's actual `playwright-json-shard-N` reports separately, with my own script. The per-leg totals equal the OLD-table modeled legs for all 6 runs, legs in order. For example, 44391395102 gives 1481 1344 1494 1637 1566 2207. So the partition-and-sum model reproduces what CI actually ran.
  - Result, OLD vs NEW max/mean ratio:

    | | OLD | NEW |
    |---|---|---|
    | In-sample (5 runs) | 1.225-1.361 | 1.009-1.108 |
    | Out-of-sample | 1.154 | 1.063 |

    NEW is clearly better on both.
- **The proof can fail.** The mutant is the NEW table with the hel1733 row removed, so that spec falls back to the median.
  - In-sample, max-mean rises from 36/14/206/48/76 to 295/285/211/171/261.
  - Out-of-sample, it rises from 99 to 208.
  - The proof is driven by the table data, so swapping in a worse table makes it show the imbalance. Caveat: on the run-wide slow run 44357733862 the mutation barely registers (206 to 211), but the other 4 in-sample runs and the out-of-sample run show it clearly.

Code-quality checklist: no code changed apart from data and comments. CONTRIBUTING.md and DESIGN.md rules: nothing applies to the changed files. The project gates triggered by `frontend/**` and `backend/**` do not apply because neither path changed; I ran the relevant gates (format check and e2e-shard selftest) instead.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed. Dev servers were not started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `.github/workflows/ci.yml:616`: the first HEL-1772 comment line is 140 characters, while the surrounding block wraps at about 115-121. Re-wrapping it would match the block. This is cosmetic, and prettier accepts it.
- For the PR body (section 3): the in-sample NEW result for run 44357733862 is still 1.108 (max-mean 206 s). This fits design.md's "run-wide slow run" expectation and is worth stating next to the after set.
