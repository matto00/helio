## Evaluation Report — Cycle 3 (evaluation-3.md)

- **Reviewed HEAD:** `39aeff591c6ec7e428e5a924341deba705e417e6`. HEAD was unchanged from the first read to the end of the runs.
- **Review base:** `7fd2f4f29157c1f159db12e99bda86ef886e4cf2`, resolved live with `resolve-review-base.sh` (= `origin/main`, which is an ancestor of HEAD).
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **What changed since the cycle-2 PASS:**
  - squash `c54c617f2`, archive `7cb6b72e3`, merge of origin/main `86663f574`, and the evidence-only commit `39aeff591`.
  - The code diff against the base is still exactly two files: `e2e/support/webFonts.ts` and `e2e/hel1444-footnoted-chart-canvas.spec.ts` (+4 lines).
  - `git diff 7cb6b72e3 HEAD` on those two files is empty, so the merge did not touch them.
- **Environment:**
  - Servers ran on 7045/9952, started with `start-servers.sh` and `assert-phase.sh` (`PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`).
  - Database: the shared `helio` DB is now at Flyway V135 with no V136, and the backend validated 135 migrations and started on it. So every cycle-3 run used the shared `helio` DB (backend `.env`, no override), not `helio_hel1613`.
  - Every Playwright run went through the shared `e2e.lock` flock, with `nice -n 19` and at most 2 workers.
  - Each log's header records cwd, HEAD, ports, DB, mode and loadavg.
  - All new logs are in `evidence/` and are left uncommitted (`*.log` is gitignored).

### Phase 1: Spec Review — PASS

**(a) The v3 sweep covers every geometry-asserting spec on the merged head.**
- I re-ran `evidence/sweep-command.sh` on HEAD: 248 lines in 43 files, byte-identical to `sweep-hits-v3-merged.txt` (`diff`: no output).
- Per-file hit counts against v2 differ only by the two new files, `hel1579-pipeline-spine-layout.spec.ts` (29) and `support/accentAudit.ts` (1).
- `git diff -U0 67c434c6b 7fd2f4f29 -- e2e` (the merge's e2e drift, excluding those two files) adds or removes no line that matches the sweep terms, `toHaveCSS`, or `.width`/`.height`. So the re-selectored specs changed no geometry assertion.
- A wider probe outside the recorded grep found no file outside the 43. It searched for `toHaveCSS("width|height|line-height|font-size")`, `.width/.height` comparisons, `innerWidth|innerHeight`, and `getComputedStyle().width|height`.
- `sweep.md`'s "Base drift" section classifies both new files.

**(b) hel1579 is font-insensitive, and its accent-audit failure is a pre-existing, font-independent rate-limit flake.**
- I instrumented every run with a scratch preload, `apicount.cjs`, that counts `/api` responses per page, the most in any rolling 60s window, and the 429s.
- **Accent-audit test alone** (`-g "accent audit"`, 1 worker), baseline and Fraunces hold (`FONT_FIRST=1 FONT_FIRST_N=1 FONT_FIRST_HOLD_FAMILY=Fraunces`, using the committed `fontfirst-preload.cjs.txt`), alternated 3 times each:
  - All 6 passed: `v4-hel1579-accent-baseline-{1,2,3}.log` and `v4-hel1579-accent-fraunces-{1,2,3}.log`.
  - Every Fraunces run logs `[fontfirst] releasing web fonts after measurement #1`, so the hold was not vacuous.
- **Whole file** (9 tests, `--workers=2`, the executor's setting), baseline and Fraunces hold, 2 each:
  - Each run: `9 passed`, `exit=0`. Logs: `v4-hel1579-file-{baseline,fraunces}-{1,2}.log`.
  - Fraunces runs log 7 releases.
- **The mechanism, measured the same in both font states.** Every instrumented accent-audit page logged identical numbers, with and without the Fraunces hold:
  - `[apicount] api_responses=123 max_per_60s=123 n429=22`.
  - The 429s are on `GET /api/pipelines/<id>/schedule`, `/outputs`, `/api/data-sources`, `/api/dashboards`.
  - The test sends 123 `/api` requests in one session in under 60s, against the default 120/min per-principal limit (`RATE_LIMIT_REQUESTS_PER_WINDOW`).
  - It goes red only when a 429 lands on a request whose failure the page renders, which is the executor's "Couldn't load this pipeline's steps".
- **Conclusion:** not font-correlated. The executor's two failures under the Fraunces hold were 2 draws from a flake that is present, at the same 22 rejected requests, in the baseline. I record it below as a follow-up candidate.
- The other hel1579 geometry assertions passed in every forced state here and in the executor's A-E logs, so leaving it unconverted is consistent with C3.

**AC3 / C3, the (d) re-run of the hel1444 red/green pair on the merged head.**
- **Mode:** the same as cycle 2 and the skeptic, `FONT_FIRST=1 FONT_FIRST_N=100000`.
- **Base spec:** `git show 67c434c6b:e2e/hel1444-...`, sha256 `92273fbc...`, identical to the base `7fd2f4f29`'s copy. It ran from a scratch mirror of HEAD's `e2e/` with only that one spec swapped in, using the worktree's `node_modules` (`rundir=` in the header).
  - Log: `v4-redgreen-hel1444-base-RED.log`, header `head=39aeff591... DEV_PORT=7045 BACKEND_PORT=9952 loadavg_start=4.90`.
  - Result: `4 failed`, `exit=1`.
  - The bar is `58px (main 57)` in all 16 measurements (bar-two/bar-range, w2/w4, 1504/1900, light/dark), each failing with `Error: <variant> @<w> <theme>: bar no taller than main`.
- **Converted spec:** run from the worktree (`cwd=.../hel-1613`), with `FONT_FIRST_ASK_DELAY_MS=400`, so the fonts are released while `waitForWebFonts` polls.
  - Log: `v4-redgreen-hel1444-converted-GREEN.log`, `loadavg_start=3.84`.
  - Result: `4 passed (1.3m)`, `exit=0`, with `57px (main 57)` in all 16 measurements and 4 release lines.

**AC5, the (c) full suite on a quiet machine.**
- Log: `v4-full-suite.log`.
- Header: `cwd=.../hel-1613 head=39aeff591c6ec7e428e5a924341deba705e417e6 dirty_code=0 DEV_PORT=7045 BACKEND_PORT=9952 DB=helio (shared, Flyway V135)`.
- Load: `loadavg_start=5.80 5.86 5.90`, lock acquired at the same moment with the same load, `loadavg_end=2.70 4.13 5.04`.
- Command: `flock -w 3600 .../e2e.lock nice -n 19 npx playwright test --workers=2`.
- Result: **`312 passed (14.6m)`, `exit=0`**, with 0 `✘` lines.

**Other checks:**
- AC1 (hel1510/hel813 refuted by probe), AC2 and AC4 are unchanged from cycles 1-2, and the code is byte-identical.
- All task items are done. The non-retired constraints C1-C5 hold.
  - C1: no retry, timeout, skip or fixme was added. `retries: 0` is untouched.
  - C2: every cited run carries a header and non-zero counts, at most 2 workers and `nice -n 19`.
  - C3, C4 and C5: as above.
- No scope creep. Commit `39aeff591` is evidence and tooling `.txt` only.

### Phase 2: Code Review — PASS

- **Gates, run fresh on HEAD:**
  - `npm run lint`: exit 0.
  - `npm run format:check`: exit 0.
  - `npx tsc -p e2e/tsconfig.json --noEmit`: exit 0.
  - eslint `--max-warnings=0` and prettier `--check` on the two changed e2e files: exit 0.
- **Gates not run:** the changed files match neither `frontend/**` nor `backend/**`, so the `npm test`, `frontend build` and `sbt testFull` gates do not apply.
- **Helper review:**
  - `closest("tr") ?? target` is backward-compatible for the row callers.
  - The conversion sits before `measure(card)`, scoped to the measured card, outside any assertion retry loop (C4).
  - No dead code. The comments are accurate.
- **Cycle-2 suggestion resolved:** the committed `fontfirst-preload.cjs.txt` now carries the `FONT_FIRST_ON_TIMEOUT` and `FONT_FIRST_HOLD_FAMILY` modes, and I used it as-is for (b).

### Phase 3: UI Review — N/A

No UI-trigger files (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) changed.

### Overall: PASS

### Non-blocking Suggestions
- **Follow-up candidate (pre-existing, not this change):** `e2e/hel1579-pipeline-spine-layout.spec.ts:174` (accent audit) sends about 123 `/api` requests per minute in one user session and gets 22 × 429 on every run, in both font states.
  - It is flaky whenever a 429 lands on `/steps`.
  - Possible fixes: split the 4 theme/accent passes across fresh users, or cut the reloads.
  - Do not raise the limit in the test.
- **Optional, `hel1579.spec.ts:261`** uses `await page.evaluate(() => document.fonts.ready)` before its header-overlap read. `webFonts.ts` documents that this is vacuous until the stylesheet applies. It passes in every forced state, so this is not a defect here, but `waitForWebFonts(header)` would be the honest wait. It belongs in the same follow-up.
- `workflow-state.md`'s `LAST_EVAL_REPORT` still points at the pre-archive path. This is cosmetic.
