## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 94e996d3006654f5f974eab36800e40712537012 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/halve-e2e-ci-time/HEL-1288`.
- **Baseline runs:** checked with `gh run view <id> --json`. All three are push runs to `main`. The e2e job durations are 37337348981 (32571b01) 16:06→16:16:28 = 16.4 min, 37324205115 = 17.9 min and 37324120988 (0afa7bf9) = 15.0 min. The logs report `Running 149/149/145 tests using 2 workers` and `149 passed (13.5m)`, `149 passed (14.8m)`, `145 passed (12.3m)`. These match the design's Context.
- **Per-test durations:** I parsed the list-reporter lines from each job log. Summed test time is 1343 s, 1481 s and 1203 s. The design says "≈ 1340–1480 s", but r3 is 1203 s (minor, see notes). The top files in r1 are state-surface-contrast-guard at 270 s (one test, :515) and focus-presence-guard at 180 s (one test, :146). After those come hel1028 82 s, hel1023 68 s, hel516-palette 62 s, hel813 60 s, hel773 59 s and hel1094 43 s (one test). The Context's tiering matches.
- **Non-test overhead:** in r1, job start 16:00:06 to `Running…` 16:02:49 is 163 s (about 2.7 min). That fits the design's figure of about 3 min.
- **Required check:** `gh api …/rulesets/14964282` returns `required_status_checks: ["ci-complete"]` on `~DEFAULT_BRANCH`. Lines 447–462 of `ci.yml` show `ci-complete` with `needs: [frontend, backend, security, e2e]` and `if: always()`, failing on any `failure`/`cancelled`. With a matrix under the same job id the result aggregates to `failure` if any leg fails, so D4's claim holds.
- **HEL-951 contract:** the e2e step is `npx playwright test` with `testIgnore` in `playwright.config.ts`. `--shard=i/N` filters the config-collected set. I read Playwright 1.55.1 `lib/runner/testGroups.js` `filterForShard`: it partitions the groups produced by `createTestGroups` over the full collected suite. Shards are not hand-picked, so **the contract is preserved**. `scripts/check-precommit-ci-parity.mjs` only parses `ci-complete`'s `needs` and the npm/node invocations inside the job blocks, so a `strategy:` block does not affect it.
- **D2 pre-identified candidates:** `hel516-screenshots.spec.ts` has 0 `expect(` and `hel519-screenshots.spec.ts` has 2, as claimed. They run about 10 s and 12 s in r1, which is small change.
- **How Playwright groups and shards tests** (load-bearing for D3/D4). In `createTestGroups`, a test whose suites are not `_parallelMode === "parallel"` goes into its file's single `general` group. With `fullyParallel: false` and no per-file `describe.configure`, **all tests in one file form one group**, run serially on one worker and are assigned as a unit to one shard. `filterForShard` assigns contiguous groups in collection order and balances by **test count, not duration**.
- **Simulation:** I modelled count-balanced contiguous sharding on r1's per-test durations (2 workers per shard, in-order assignment).
  - Guards left as single tests: the N=4 slowest-shard suite is about 368 s. About 6.1 min of suite plus 2.7 min of overhead misses ≤ 7.
  - Guards split into about 16 **parallel-mode** tests each (+4 s setup per cell): the N=4 slowest shard is about 226 s (3.8 min). Plus 2.7 min of overhead that gives about 6.5 min. That reaches the target only if D5's overhead savings land too.
  - Guards split into many tests in the **same default-mode file**: those tests stay one group, so the slowest shard gets no better and gets worse by the per-cell login/seed cost.
- **Guard aggregates** (`e2e/state-surface-contrast-guard.spec.ts` 515–863, `e2e/focus-presence-guard.spec.ts` 143–384). Both are a single test looping `for theme × routes` (7 routes, plus chrome on `/`, plus 3 overlays). Both end in **run-wide aggregate assertions**:
  - state-surface `expect(unresolvedFraction).toBeLessThan(0.5)` (L862) over all cells.
  - focus-presence `expect(totalMeasured).toBeGreaterThan(0)` (L383).
  - state-surface's per-route `assertPartitioned` credits chrome coverage collected on the same route's document (L686–697).
  - Neither file has a `beforeAll`.

### Verdict: REFUTE

The plan can reach ≤ 7 min, but only through a mechanism the design does not specify. Implemented literally ("a `for` … generating one `test()` per cell" with global `fullyParallel: false` kept), D3 produces no scheduling gain, and the target fails at the arithmetic level. The remaining items are under-specifications that would surface as a red CI run or an unverifiable ledger.

### Change Requests

1. **D3/D4 — make the split cells actually schedulable.** Under Playwright 1.55.1 (`testGroups.js` `createTestGroups`), tests in a default-mode file are one group: one worker, one shard. D3 must require either `test.describe.configure({ mode: "parallel" })` scoped to the two guard files only, or splitting the guards into separate files. State that this is per-file and not the globally rejected `fullyParallel: true`. Also require that the split adds no file-level `beforeAll`/`afterAll`; with one, the cells fall into `parallelWithHooks` and get chunked by worker count. Add an acceptance signal to tasks 3.1/3.2: `npx playwright test --list --shard=i/N` for the chosen N shows the guard cells spread across more than one shard.
2. **D4 — account for count-based contiguous sharding in the arithmetic and the tuning procedure.** `filterForShard` balances by test count over contiguous file-ordered groups, not by duration. The Context arithmetic ("drop ~3× from parallel runners") assumes duration balance. Redo it on the count basis. My r1-based model gives a slowest-shard suite of about 226 s at N=4 even with parallel-mode guards, so total ≈ 6.5 min with today's overhead. Two things follow:
   - D5's overhead savings are **load-bearing**, not optional. Say so.
   - Task 4.3 must check shard composition with `--list --shard` before spending CI runs. It must name the lever if the slowest shard is over budget: N, a parallel-mode `describe` on another heavy file proven isolated, or escalation under C5.
3. **D3 — define the cell boundaries and what happens to the run-wide assertions.** Enumerate the cells: for example theme × {chrome, each of the 7 routes, each overlay}. For each of these say how it maps to the split:
   - state-surface's aggregate `unresolvedFraction < 0.5` (L862);
   - focus-presence's `totalMeasured > 0` (L383);
   - the chrome-coverage credit inside `assertPartitioned` (chrome is probed once per theme on `/`, then credited per route).

   Per-cell versions are stricter (a cell with few resolvable elements can newly fail), and a "sum" version needs a cross-test aggregation that parallel cells cannot share. Pick one and justify it. "Must hold per cell" is not enough when an assertion is defined over the whole run. The population-equality check should name the exact log line compared: `[HEL-866 guard] elements probed: N` and the focus guard's equivalent.
4. **Task 4.1 — artifact names must be unique per shard.** Under a matrix, the existing `upload-artifact@v7` step with fixed `name: playwright-report` (ci.yml:435), and any new always-upload JSON artifact, would collide across legs. `upload-artifact` v4+ rejects a duplicate artifact name within a run, so the second leg's upload fails. Require `name: …-shard-${{ matrix.shard }}` (or an equivalent) for both uploads. Require the per-shard `/tmp/backend.log` and `/tmp/frontend.log` to stay attached on failure.
5. **D2 — tighten the equivalence bar and name the approver.**
   - A Jest/RTL test with mocked services plus a backend route spec does not cover the real browser-to-backend seam an e2e test covers. Require the surviving test to assert the same behaviour at the same or a stronger integration level, *or* a written argument that the removed test asserts nothing integration-specific. Screenshot-only specs with zero behavioural `expect` are exempt from this bar but still get a ledger row.
   - Task 2.2 says "Delete the approved redundant specs" without saying who approves. Define it: for example, every removal of a test with at least one behavioural `expect` is listed for the final-gate skeptic, or for the driver's ruling, before deletion lands.

### Non-blocking notes

- Context says summed test time is "≈ 1340–1480 s". Run 37324120988 measures 1203 s (145 tests). The before-profile should give per-run values.
- D1/task 1.1: Playwright's `json` reporter writes to stdout when it has neither `outputFile` nor `PLAYWRIGHT_JSON_OUTPUT_NAME`. Make sure a bare local `npm run e2e` does not dump JSON into the list output. Either set an `outputFile` or enable it only under CI. The output path should fall under the gitignored `test-results/`.
- D5(b): most of the 29 s browser step is likely `--with-deps` apt work, which caching `~/.cache/ms-playwright` does not remove. Keep the executor's measure-then-adopt framing.
- D7 defers the post-merge 5-run median and flake rate to the driver (AGENT_MERGE is true). The PR body should say plainly that the ≤ 7 min AC is unmeasured at merge time.
- The `backend` job (18.2 min in r1) is now longer than e2e. A faster e2e job will not shorten the overall CI wall-clock until HEL-1287 lands. This is outside scope but worth stating in the PR.
