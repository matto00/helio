## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `6a7e5a04b50f635ab3389c9d216980e88a2ab3e2` against live-resolved base `86763e881cee3bd3e0aea7957db619be51479a0f`
(`resolve-review-base.sh`, exit 0). One commit on the branch. The code diff touches only `e2e/support/panelGridReady.ts`,
`e2e/hel1583-mobile-dashboard.spec.ts` and the new `e2e/hel1724-panel-stack-ready.spec.ts`, plus openspec artifacts.

### What I verified (with evidence)

- **AC1: root cause comes from the trace, not the hypothesis.** I read the CI trace myself
  (`.concertino/scratch/HEL-1724/ci-artifact/.../trace/1-trace.trace` in the main checkout). The geometry
  `page.evaluate` returned `cardLeft` with **6** entries and `gaps = [10, 10, -379.7613830566406, 10.23, 10.40]` for a
  3-panel dashboard. The same file contains `crossfade__skeleton--leaving` 3 times. That matches design.md's Context:
  3 skeleton stubs plus 3 real cards in one grid cell. No retries were added (`playwright.config.ts:167` `retries: 0`).
  No timeouts were raised: the helper's default of 15_000 mirrors `waitForPanelGrid`.
- **AC2: red first under a forced repro.** I re-ran this myself instead of trusting `red-unmodified.txt`. I applied
  the executor's `mkprobe.sh` injection (3 s skeleton fade plus a 1.5 s panels delay) to two throwaway copies: one of
  `git show 86763e881:e2e/hel1583-mobile-dashboard.spec.ts` and one of the fixed spec. I ran the :156 test in both
  themes. The base copy failed 2/2 with `Received: -380`, the same signature as CI's -379.76. The fixed copy passed
  2/2. I deleted both throwaway copies afterwards, and `git status` is clean apart from the evaluator's untracked
  report.
- **AC2: 40/40.** I ran
  `DEV_PORT=7156 nice -n 19 npx playwright test e2e/hel1583-mobile-dashboard.spec.ts:160 --repeat-each 20 --workers 2 --trace retain-on-failure`
  and got **`40 passed (2.0m)`**: no failures and no flaky tests. The whole hel1583 file plus the guard gave `25 passed`.
- **The guard can fail (my own mutation).** I removed step 2
  (`getByLabel("Loading panels")` toHaveCount(0)) from `waitForPanelStack` and ran the guard twice. It failed 2/2
  with `no skeleton stub is left among the stack items, Expected: 3, Received: 6`. I restored the file byte-for-byte
  from a copy, and `git diff` is empty afterwards. The unmutated guard passed 3/3 under `--repeat-each 3`. The
  executor's step-1 mutation evidence (`Expected 0 Received 1`) fits the helper's ordering, but I did not re-run it.
- **C1:** `e2e/hel1575-dashboard-tabs.spec.ts` is not in the diff. The change to `panelGridReady.ts` only adds code:
  a new export and function, plus one doc-comment sentence on `waitForPanelGrid`, whose body is unchanged.
- **C2:** no `retries` or `describe.configure({ retries })`, and no timeout increases anywhere in the diff.
- **C3:** the guard's `toHaveCSS("transition-duration","3s")` targets
  `.crossfade__skeleton` that `has: getByLabel("Loading panels")`. That is the panels-level layer
  (`hel1724-panel-stack-ready.spec.ts:65-74`).
- **`open()` callers:** all callers open `dashboardIds[0]`, which has 3 panels, at widths 320 to 768. The whole-file
  run passed at every width, so `waitForPanelStack(page, 3)` holds for every caller. After the chip switch, :285 uses
  a retrying `toContainText("Z")`, so it does not race.
- **`git commit -n` bypass:** the claim is accurate and the bypass is acceptable. `npm run check:helio-mcp-types` fails
  in the worktree (rc=2: TS7016 `express` types, TS2353 zod `error:` option). It fails with identical errors in the
  main checkout at 86763e881, which is this branch's base. The diff touches no `helio-mcp/**` file. The failure is
  local `node_modules` drift and not caused by this change.
- **Gates on the changed files:** `prettier --check` exit 0, `npm run check:e2e-types` exit 0, and
  `eslint --max-warnings 0` exit 0.
- **UI judgment:** not applicable. No `frontend/**` change; the change is test-only.

### Verdict: CONFIRM

### Non-blocking notes
- sweep.md has two small inaccuracies, both noted by the evaluator. The hel1392-remount-staleness row describes a
  `.mobile-panel-stack` selector, not an item hit. The header says "14 files besides hel1583", but the count is 13.
  The verdicts themselves are not affected.
- The D3 entrance-animation probe was taken only under the stretched fade, so the evidence should say that. The
  residual 10.0 to 10.4 gaps are within the 8 to 12 tolerance.
- PR body should call out the change to the shared `e2e/support/panelGridReady.ts` (C1) and the `-n` bypass with its
  environmental cause.
- Both the guard's init-script stretch and `mkprobe.sh`'s stretch hit every `.crossfade__skeleton`, including inner
  ones. The guard's proof assertion is still scoped to the panels layer as C3 requires, so this is fine.
