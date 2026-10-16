## Evaluation Report — Cycle 4 (evaluation-6.md)

- **Reviewed HEAD:** `071110b8ba2118529e14d3312be22935b9c87739`. It was the same at the start of review and at the end of the full suite (`head_end=` in `full-suite.log`). The worktree was clean throughout.
- **Review base:** `db91c840ea729c1b3f662ae1eb01643ac1739e2d`, resolved live with `resolve-review-base.sh`. It equals `git ls-remote origin main` and is an ancestor of HEAD (merge `5279fc3fd`).
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **Code delta since evaluation-5's head:** `git diff db91c840e...HEAD -- e2e frontend backend playwright.config.ts schemas` covers:
  - `e2e/support/webFonts.ts` and `e2e/hel1444-footnoted-chart-canvas.spec.ts`, both unchanged since evaluation-5;
  - `e2e/hel1572-appearance-preferences.spec.ts`, +4 lines in commit `071110b8b`.
  - The HEL-1617 merge touches only `helio-mcp/**` and its own archive, so no e2e code changed.
- **Environment:**
  - Servers ran on 7045/9952, started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`). The listener cwds were `.../hel-1613/frontend` and `.../hel-1613/backend`.
  - Shared `helio` DB, Flyway max V135, which matches HEAD's newest migration (V135).
  - Every Playwright run went through the shared `e2e.lock` flock, with `nice -n 19` and `--workers=2`. The 1-minute load was between 1.7 and 6.3 at run starts, never above 10.
  - Probe specs ran from a scratch mirror (`.concertino/scratch/HEL-1613/evaluator6/tree`), so the worktree's `e2e/` was never touched.
  - Every run's teardown logged `deleted N recorded throwaway user(s)`, with N > 0. A DB check found 0 leftover users from my runs.
- **Evidence:** all logs below are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1613/evidence/.concertino/scratch/HEL-1613/evaluator6/`, abbreviated `R6/` from here on. The probe generator is `R6/mk6.py` and the gate is `R6/tree/e2e/zzgate6.ts`. The gate is the executor's `zzfontgate.ts` plus one switch, `FONT_HOLD_START=<point>`, which starts holding fonts only at that gate point and starts `FONT_TIMER_MS` from it. Every log header records cwd, HEAD, ports, DB, font env and loadavg.

### Executor claims, verified

1. **Code change** is exactly as claimed: an import, then `waitForWebFonts(page.locator(".source-list-table tbody tr").first())` at `:386`, before `const comfortable = await rowHeight()`, and at `:395`, before the second `rowHeight()`.
   - Nothing else changed: the expected `8`, the precision `0` and the `padTop` checks are unchanged.
   - Neither wait sits inside `expect.poll` or an assertion retry, so C4 holds.
2. **Red probe, and whether it manufactured the red.** It did not manufacture the failure, but on its own it was not a faithful reproduction. Details:
   - **What the executor's red log does:**
     - `v9-redgreen-hel1572-base-RED.log` holds all fonts until after the first measurement and then waits for them to settle.
     - It also adds a probe-only `waitForWebFonts` before the second measurement.
     - Both gotos use `waitUntil: "commit"`.
     - So the second measurement is forced into the web face. Its diff of 10 (44 fallback vs 34 web) has the same value and the same face pairing as the natural failure in evaluation-5 (`Received: 10`).
   - **Without the probe-only wait, that mode is green.** `R6/logs/p3-u-afterfirst-settle.log`: 3 of 3 passed, 44 vs 36, diff 8. After the reload the second document re-requests the fonts and is still loading when it is measured, so both measurements are in fallback.
     - On its own, the executor's red therefore shows only that the first-step wait is needed, under a constructed state.
   - **Independent same-mode red, with no probe-only wait.** I used the executor's own green mode: `FONT_HOLD=all FONT_TIMER_MS=1500`, all fonts held and released by a timer.
     - Unconverted spec: `R6/logs/p1-u-timer1500.log` failed 1 of 3, and `R6/logs/p7-u-timer1500-r10.log` failed 1 of 10.
     - Each failure was `comfortable=44 ... compact=34 diff=10`, with Schibsted Grotesk `loaded` by the second measurement.
     - This is the natural race: the timer lands between the two documents.
   - **Converted spec in the identical mode:**
     - `R6/logs/p2-c-timer1500.log`: 3 of 3 passed.
     - `R6/logs/p8-c-timer1500-r10.log`: 10 of 10 passed.
     - Every run measured 42 vs 34, diff 8.
     - The comfortable measurement was taken at t=2167-2310 ms, after the 1500 ms release, so the wait actually blocked.
   - **Verdict on the claim:** the failure is real and the conversion fixes it. My same-mode pair (p1/p7 red, p2/p8 green) stands as the faithful red/green that design D5 calls for.
3. **Second wait (`:395`): the executor showed no red for it. I ran a converse state.** Design D5 asks for red/green for every step that gets a wait.
   - **Setup:** the first document is in the web face, and fonts are held only from the after-first point.
   - **Unconverted at `:395`** (`zz6uc`, which adds a probe-only wait only before the first measurement):
     - `R6/logs/p4-uc-converse-never.log`: 3 of 3 failed, `Received: 6` (42 web vs 36 fallback).
     - `R6/logs/p5-uc-converse-timer1500.log`, with the release timer at 1500 ms from the hold start: 3 of 3 failed, `Received: 6`.
   - **Converted spec in the p5 mode:** `R6/logs/p6-c-converse-timer1500.log`, 3 of 3 passed, 42 vs 34, diff 8.
   - So the second wait is justified as well.
4. **Natural rate, no injection, same load (about 6):**
   - Unconverted spec at `--repeat-each=20`: `R6/logs/n1-unconverted-natural-r20.log`, **3 of 20 failed**, all `Received: 10`.
   - Converted spec at `--repeat-each=20`, run from the worktree: `R6/logs/n2-converted-natural-r20.log`, **20 of 20 passed**.
   - The executor's `v9-hel1572-repeat10.log` (10 of 10, load 1.3) is consistent with this.
5. **Full suite.**
   - The executor's `v9-full-suite.log` shows 340 passed on 071110b8b.
   - **I re-ran it fresh:** `R6/logs/full-suite.log`.
     - Header: `cwd=.../hel-1613 head=071110b8ba21… dirty_code=0 DEV_PORT=7045 BACKEND_PORT=9952 DB=helio(shared,Flyway V135) loadavg_start=5.02`.
     - Command: `flock … nice -n 19 npx playwright test --workers=2`.
     - Result: **`Running 340 tests` → `340 passed (15.8m)`, exit=0.**
     - Teardown deleted 320 users. `head_end=071110b8b…`.
6. **sweep.md is updated.** It has a new section for the HEL-1572 drift: hel1572:358 is classified as converted, the font-insensitive classifications for the other hel1572 assertions, hel813 and the contrast guard are recorded with values, and the cross-document forced state is recorded as a method gap.

### Phase 1: Spec Review — PASS

- **AC1:** holds. The hel1510 and hel813 verdicts are unchanged, and the hel813 code is unchanged since evaluation-5's (c) re-probe.
- **AC2:** holds. I re-ran `evidence/sweep-command.sh` on HEAD: 262 lines in 44 files, identical to `sweep-hits-v5-merged.txt` apart from hel1572's line numbers, which move by +1 for the new import. HEL-1617 added no e2e hits.
- **AC3:** met. hel1572:358 is converted, with red then green for both waited steps (items 2 and 3 above). The earlier conversions (hel1444, the `rowDeleteGesture` callers) are unchanged.
- **AC4 and C1:** hold. In the branch diff for `e2e/` and `playwright.config.ts`, no added line contains retries, raised timeouts, `skip`, `fixme` or `slow`. The only grep hit is a comment in `webFonts.ts`.
- **AC5:** met. 340 of 340 pass on the final head, in a fresh evaluator run.
- **Constraints:**
  - C2: every cited run shows this worktree's path and ports, with non-zero counts.
  - C3: the conversion is backed by red then green.
  - C4: both waits sit before the measurement, scoped to the measured row, outside any retry.
  - C5: the reds use held responses released at chosen points.
- **No scope creep.** The only code change is the two waits plus the import.

### Phase 2: Code Review — PASS

- **Gates, fresh on HEAD, in the worktree:**
  - `npm run lint`: exit 0.
  - `npm run format:check`: exit 0, "All matched files use Prettier code style!".
  - `npx tsc -p e2e/tsconfig.json --noEmit`: exit 0.
  - `npm test`, the frontend build and `sbt testFull` do not apply, because the branch diff touches no `frontend/**` or `backend/**` file.
- The change reuses the shared helper (DRY), uses the same locator the spec already measures, and its comment states the reason (about 2px of reflow).
- No dead code, no new escape hatches.

### Phase 3: UI Review — N/A

The branch diff against `db91c840e` touches no UI-trigger path (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- **Fix the red proof recorded in `sweep.md`:**
  - In the hel1572:358 row, cite this report's same-mode pair (p1/p7 red vs p2/p8 green, under `FONT_HOLD=all FONT_TIMER_MS=1500`) and the converse pair for `:395` (p4/p5 red with diff 6, p6 green).
  - Add a note that the `v9` red needs its probe-only second wait: without that wait, the after-first and settle mode is green (p3).
- **Comment placement in hel1572:** the `// Top and bottom padding each shrink 8 -> 4.` comment at `:394` now sits above the new wait instead of the assertion it describes. Moving the wait above the comment would keep them together. This is cosmetic.
- **Stale registry directory:** the worktree has a leftover `.e2e-user-registry/1792091387310-872829/` from an Oct 15 hel1579 run. Its users are already gone from the DB (0 rows). The orchestrator can drop the directory at teardown.
- **Unpersisted v9 logs:** the `v9-*.log` files are gitignored (`*.log`). I persisted them under `/home/matt/Development/helio/.concertino/runs/HEL-1613/evidence/openspec/changes/archive/2026-10-15-adopt-webfonts-wait-layout-specs/evidence/` so `sweep.md`'s citations survive worktree cleanup.
