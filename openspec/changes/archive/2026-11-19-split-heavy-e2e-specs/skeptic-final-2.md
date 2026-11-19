## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `638732135ed5ac6858eab7ed53f7b808d47a811f`. `resolve-review-base.sh` resolved the base live as `3bf3590ec2cb2bf4b1478159a8cae832274becf6` (rc 0). The branch has 3 commits over the base and 30 files changed. Round 1 (`skeptic-final-1.md`, on `aa973721e`) refuted the change on one shape defect: test code was copied into every split part (C18). This round checks that fix from ground truth and re-checks everything it could have disturbed. The change has no UI, so the visual step does not apply.

### What I verified (with evidence)

- **CR1 is resolved: hel1583 is registered once.**
  - `e2e/hel1583-glass-nav-light.spec.ts` and `-dark.spec.ts` are now 13 lines each. Each part runs its file-level `test.describe.configure({ mode: "parallel" })`, then calls `describeGlassNav("light")` or `describeGlassNav("dark")`.
  - I compared the base `for (const theme of THEMES) {` block with `export function describeGlassNav(theme: "light" | "dark") {` in `e2e/support/hel1583-glass-nav.ts`. After de-indenting, the only difference is that header line. The block was moved verbatim.
- **CR2 is resolved: the hel1665 matrix is registered once.**
  - `describeHomeLoadMatrix(theme, order)` in `e2e/support/hel1665-home-phone-stability.ts` holds the 69-line matrix test.
  - Each of the four parts calls it once, after its own `configure` and `test.setTimeout(180_000)`.
  - The `test(` call sites across parts plus support match the base exactly: hel1665 9 = 9, hel1583 10 = 10, hel1733 12 = 12. No test code is duplicated anywhere.
- **No test lost or weakened (fresh evidence).**
  - My own HEAD list came from `DEV_PORT=7210 npx playwright test --list --reporter=json --project=dev`. It has 932 tests against the base's 932, with 0 multiset differences on `project | describe chain > title`.
  - Root suites went from 118 to 124 (+6 = 9 parts − 3 originals). Per part: hel1583 15/15, hel1665 21/23/25/21, hel1733 10/9/13.
  - I re-ran the executor's `proof.mjs` (a copy pointed at my own HEAD list) after first checking with `cmp` that its three `*.base.ts` inputs are byte-identical to `git show 3bf3590ec:<file>`. Result: bodies only in base 0, only in new 0, for all three specs. `expect` counts are equal both inside test bodies (43/72/64) and file-wide (47/116/65).
- **Shard attribution is unaffected by moving the tests into support modules.**
  - Playwright's list JSON now reports `spec.file` as the support module for these tests. That would matter if the tool keyed on `spec.file`.
  - It does not: `filesFromList` and `testsOf`/`fileSumsForRun` (`scripts/e2e-shard.mjs:134`, `:164`, `:204`) key on the root suite's `file`, which is the part spec file.
  - So the leg plan and `verifySelection` still see the nine part files.
- **AC2: the table reproduces at HEAD.**
  - I ran `node scripts/e2e-shard.mjs weights --list <my HEAD list>` over the 5 source runs (44446279352, 44455550476, 44468195695, 44488684006, 44498291938).
  - Excluding the `# Runs`/`# Regenerate` header lines, the output is identical to the committed `e2e/shard-weights.tsv`, with 0 dropped results.
  - Key rows: hel1608 86; hel1665 parts 172/179/199/173; hel1733 parts 129/94/113; hel1583 parts 101/103.
- **AC1:** verified in round 1 against the raw reports and the jobs API. Commit 3 changes only one prose sentence in `variance.md` (the proof summary, which my re-run confirms) and touches no numbers.
- **Gates, run fresh at HEAD, all rc 0:**
  - `check:e2e-shard:selftest` (28 cases), `check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths` (180 files each). Both checkers walk `e2e/` recursively, so the test bodies now in `e2e/support/` are still scanned.
  - `eslint --max-warnings=0` on every added or modified `.ts`/`.mjs` file.
  - `prettier --check` on every added or modified non-tsv/yaml file.
- **Runtime proof of the refactored registration (C14).**
  - Servers ran through `start-servers.sh` with `DATABASE_URL` pointed at `helio_hel1778` and `ANTHROPIC_API_KEY` empty; `assert-phase.sh servers` printed PASS.
  - Runs used Playwright with 2 workers under `nice -n 19`:
    - hel1583 light + dark: **30 passed**.
    - hel1665 light-summary-first + dark-dashboards-first: **48 passed**.
    - hel1665 light-dashboards-first + dark-summary-first: **42 passed**.
  - Every throwaway user was deleted by the suite's teardown. Servers were stopped with `stop-servers.sh`, and `git status` shows no stray files.
  - These runs are correctness checks only, not timing (C15).
- **AC3 (Delivery).** Decision 6 and task 5.1 remain sound, as reviewed in round 1. Commit 3 changes no file names or weights, so the out-of-sample prediction and `before.md` still apply.

### Verdict: CONFIRM

### Non-blocking notes

- **Delivery log fallback.** CI's `list` reporter now prints the support-module path for tests registered there, e.g. `e2e/support/hel1583-glass-nav.ts:607:9 › ...` (seen in my local run). If an attempt's JSON reports are lost and Decision 6 falls back to job logs, key those lines by title path (or map support paths to parts), not by the printed file. Downloading each attempt's reports before the next rerun, as Decision 6 already requires, avoids the issue.
- **No evaluator report covers HEAD.** `evaluation-2.md` reviewed `aa973721e`. Commit 3 touches only `e2e/**` and three change artifacts, and I ran the e2e-relevant gates above myself. The full-repo `npm test`/build were not re-run here; nothing they cover changed in commit 3.
- No mtime-ordering evidence is load-bearing in this review.
- Carried from round 1: `hel1575-dashboard-tabs` (760 s, one file) is the next floor on any leg and is already in the follow-up table in `variance.md`.
