## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/e2e-ci-sharding/spec.md (untracked in the worktree, HEAD
2b33217e1a49aa31d0598380913c2fff0ac3e89a). Precedent: openspec/changes/archive/2026-11-19-split-heavy-e2e-specs/.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-remaining-heavy-e2e/hel-1789`.
- **Planning-probe table (design Context) holds.** `wc -l`: hel1575-dashboard-tabs 1069, hel1582-sweep-375 7,
  hel1582-mobile-pipeline 1204, hel1684-draft-structural 642, state-surface-contrast-guard 993,
  hel1573-motion-primitives 325. `e2e/shard-weights.tsv` rows: 740 / 358 / 343 / 337 / 276 / 176. The six
  `e2e/hel1774-modal-scroll-*.spec.ts` files exist and have no rows.
- **hel1582-sweep-375 is a wrapper.** It calls `registerHeavySweeps` at `e2e/support/hel1582Phone.ts:340`. That function
  holds a file-scope `test.use` (mobile 375x812, touch) and one describe with two tests: C8 with `setTimeout(480_000)`,
  and MAXIMAL with `setTimeout(1_500_000)` and a runtime `test.skip` for widths other than 375 unless `HELIO_E2E_SLOW=1`.
  `.github/workflows/e2e-slow.yml:68` runs 390 and 768 by explicit path, so the 375 split does not touch that workflow.
- **Weight attribution will not throw.** I ran `npx playwright test --list --reporter=json --project=dev` at base, with
  output in scratch `.concertino/scratch/HEL-1789/skeptic/`. Across the whole suite, none of the six specs has a title
  path that also appears in another file (0 duplicates in each). So `attributeFile`'s "ambiguous moved test" throw
  (`scripts/e2e-shard.mjs:180-190`) cannot fire for a faithful split. Test counts: 22 / 2 / 24 / 26 / 20 / 9. The
  design says "about 20" for hel1582-mobile-pipeline; the real count is 24 (immaterial).
- **The runner-record artifact name is safe for the weights tool.** `findReports` (`scripts/e2e-shard.mjs:255-263`)
  treats any subdirectory that holds a `results.json` as a report. The documented download uses
  `-p 'playwright-json-shard-*'`. `e2e-runner-shard-<n>` is safe as long as it never contains a file named
  `results.json`.
- **The sampler matches what the design assumes.** `scripts/ci-load-sampler.cjs` takes `<out.ndjson> <maxSeconds>`.
  It emits user/system/iowait/steal/idle percentages, the run queue and load1, and exits on SIGTERM. Its test exists
  (`scripts/ci-load-sampler.test.js`). The frontend job's pattern is at `.github/workflows/ci.yml:168-190`: nohup,
  recorded PID, `if: always()` stop.
- **CI facts.** The main CI runs since d8cdfb460 match the design's list and conclusions (`gh run list`). PR #1183 run
  44599315768 has `run_attempt` 6. Its 7 `playwright-json-shard-*` artifacts are all from about 21:30-21:37Z, so only
  attempt 6 survives as JSON; the design already uses job logs for attempts 1-5. The e2e job's setup before
  `Run e2e suite` took 149-197 s per leg on run 44660016746 (jobs API).
- **Lessons from the precedent gates are carried over.** These are the HEL-1778 skeptic-design-1/2 and skeptic-final-3
  findings:
  - counting is decided per e2e leg, not by the run conclusion (Decision 1);
  - the dead artifacts of earlier attempts are handled through job logs;
  - every run's slowest-leg drivers are ranked across all specs (task 1.2);
  - the clauses of the balance requirement are addressed (Decision 6).
- **AC coverage.** AC1, the per-spec cause and then split or cost cut, is covered by Decisions 1-2 and tasks 1-3.
  AC2, the leg-wide slowdown, by Decision 4 and tasks 2 and 4. AC3, at least 5 counting runs, by Decision 6 and task
  6.2. No scope drift beyond the runner record, which AC2's "investigate" reasonably motivates. The spec delta covers
  it.

### Verdict: REFUTE

### Change Requests

1. **The parity proof (Decision 3c, task 3.5) does not cover assertions and options outside `test(...)` bodies.** The
   ticket requires "keeping every test and assertion". Ground truth has load-bearing code that the proof as written
   never compares:
   - **An assertion in a hook.** `e2e/hel1684-draft-structural.spec.ts:364-369` has a `test.beforeEach` that attaches
     `attachApiRequestCounter`. Its `test.afterEach` asserts `expect(counter.report().count429 ...).toBe(0)` for every
     test in `describeMode`. A split that drops or mis-scopes it would lose that assertion. Decision 3(c) counts
     `expect(` "inside test bodies" only, so it would still report zero differences.
   - **Scope options.** `e2e/hel1684-draft-structural.spec.ts:356-361` and `:476` set the viewport, a describe-level
     `test.setTimeout(120_000)` and `actionTimeout`. `e2e/hel1582-mobile-pipeline.spec.ts:38` has a file-scope
     `test.use`. `e2e/support/hel1582Phone.ts:341` holds the mobile/touch `test.use` that the new
     `registerC8Sweep`/`registerMaximalSweep` must each carry. `e2e/hel1573-motion-primitives.spec.ts:27-28` sets
     `mode: "parallel"` and `video: "on"` with a 1900x1000 viewport. `state-surface-contrast-guard.spec.ts:771-772`
     sets parallel mode and `setTimeout(120_000)`.

   A part missing any of these changes a test's viewport, timeout or mode and passes silently, which the Non-Goals
   forbid. **Required:**
   - Extend Decision 3(c) and task 3.5 so that, for every test, the proof compares the scope chain that applies to it
     between base and branch. That means every enclosing `test.use`, `test.describe.configure`, describe/file-level
     `test.setTimeout`/`test.slow`, and the source of every `beforeEach`/`afterEach`/`beforeAll`/`afterAll` hook,
     whitespace-normalised.
   - Count `expect(` in hook bodies as well as test bodies.
   - Name hel1684's `afterEach` count429 assertion as a case the proof must show preserved.

2. **Task 3.4's reference sweep misses a working reference and conflicts with "no product code".**
   - **The working reference.** `package.json:65` defines `"e2e:state-contrast-guard": "playwright test
     e2e/state-surface-contrast-guard.spec.ts"`. Once that file is removed, the script finds no tests. It is not in
     task 3.4's examples (README, comments, e2e-slow.yml, testIgnore).
   - **The conflict.** Comment-only references to the old names sit in product source:
     - `frontend/src/app/App.css:120,244`;
     - `frontend/src/theme/themeParityGuard.css.test.ts:22`;
     - `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css.test.ts:58`;
     - `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css.test.ts:8`.

     There is also the binding `DESIGN.md:150,1628`. Task 3.4 says "update references", while proposal/C17 say "no
     product code". An implementer can read this either way.

   **Required:**
   - Task 3.4 names the `package.json` script and how it is repointed, e.g. a Playwright path filter that matches every
     part. It also says how its continued discovery is checked, e.g. `npx playwright test --list` through that script.
   - State the rule for comment-only references under `frontend/src/` and in `DESIGN.md`. Either update them as
     comment-only edits, explicitly allowed and listed in files-modified.md, or leave them with a stated reason.

3. **The spec delta's "stop by itself before the job limit" contradicts the design's example bound.**
   - The new requirement (specs/e2e-ci-sharding/spec.md, scenario "The record cannot fail or extend a leg") says "the
     sampler exits by itself before the job limit".
   - Decision 4(b) and task 4.2 start the sampler "before the suite" with an example bound of 1440 s. Measured setup
     before `Run e2e suite` is 149-197 s (run 44660016746). So a 1440 s bound expires about 1590-1640 s into a job whose
     limit is 1500 s.
   - **Required, one of:**
     - (a) start the sampler at the job's first step and bound it under 1500 s minus that small offset;
     - (b) derive the bound from the time already elapsed when it starts;
     - (c) reword the requirement to what is actually guaranteed (a fixed self-stop bound plus the runner's end-of-job
       process cleanup), and say why that is enough.

     The bound must still cover the whole suite on a slow leg, which is the case the record exists for.

### Non-blocking notes

- `--list` with `HELIO_E2E_SLOW=1` (Decision 3a) will match the plain list. The gate is a runtime `test.skip`
  (`hel1582Phone.ts:399-402`), and `playwright.config.ts` has no `HELIO_E2E_SLOW` condition. It does no harm, but it
  does not prove that the gated sweeps still skip. Proving that is covered by moving the `test.skip` verbatim, which
  item 1's scope proof can include.
- Task 6.2 stops at 5 counting runs or 8 total. Say what is reported if 8 runs give fewer than 5 counting runs. AC3 is
  then unmet, so either escalate or report the shortfall. Do not quietly accept it.
- Make sure the runner-record artifact can never hold a file named `results.json`. `findReports` would then read it as
  a report if someone downloaded every artifact without a `-p` filter.
- On splitting `registerHeavySweeps`: if each narrower function wraps its test in its own
  `test.describe("HEL-1582 phone pipeline page (live)")`, the 390 and 768 files get two sibling describes with the same
  title. The title paths are unchanged, so this is fine, but say so in variance.md so a reviewer does not read it as
  drift.
