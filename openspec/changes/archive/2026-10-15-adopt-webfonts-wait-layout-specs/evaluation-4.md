## Evaluation Report — Cycle 3, re-gate after base drift (evaluation-4.md)

- **Reviewed HEAD:** `7e696754517249632d3eec32a80ee77ce81e005f`, the merge of `origin/main` (`38de7610a`, HEL-1576) into the branch. HEAD did not change between the first read and the end of the runs.
- **Review base:** `38de7610a4a54d23ce748f914cd558cb46ccab95`, resolved live with `resolve-review-base.sh`. It equals `origin/main` and is an ancestor of HEAD.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **This ticket's code did not change in the merge.**
  - `git diff 861da5ce1 HEAD -- e2e/support/webFonts.ts e2e/hel1444-footnoted-chart-canvas.spec.ts` is empty.
  - Against the new base, the code diff is still exactly those two files: `webFonts.ts` (43 lines changed) and `hel1444` (+4). Everything else is archive or evidence.
- **The merge's e2e drift** is 9 specs, +63/-26 lines:
  - `hel1023`: `GRID_MARGIN` 18 → 12.
  - `hel1028`, `hel1230`, `hel1457`: they now enter layout edit mode before dragging.
  - `hel1189`, `hel1260`, `hel516`, `hel909`, `hel910`: "Add panel" is now the meta row's button, replacing the kebab item.
- **Environment:**
  - Servers: this worktree's, on 7045/9952, started with `start-servers.sh` (`PASS servers` from `assert-phase.sh`) and stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`).
  - Backend: process cwd `.../hel-1613/backend`, `DATABASE_URL=.../helio`.
  - Database: the shared `helio` DB is at Flyway V135, and HEAD's newest migration is `V135__pipeline_run_step_row_counts.sql`. They match, so every run used the shared `helio` DB.
  - Every Playwright run went through the shared `e2e.lock` flock with `nice -n 19` and at most 2 workers.
  - The 1-minute load never exceeded 10 at any run start. The highest seen was 8.35, during the css-block run.
  - Each log's header gives cwd, HEAD, ports, DB, FONT_ENV and loadavg.
  - Tooling: copied from `evidence/scratch/*.txt` into `.concertino/scratch/HEL-1613/evaluator4/`. The wrappers I used are saved back as `evidence/scratch/eval4-*.txt` and `fontfirst-nowait-preload.cjs.txt`.
  - Everything is uncommitted.

### Phase 1: Spec Review — PASS

**(a) Sweep on HEAD.** `evidence/sweep-command.sh` gives 248 lines in 43 files, saved as `evidence/sweep-hits-v4-merged.txt`.
- Diff against `sweep-hits-v3-merged.txt`: the per-file hit counts are identical, with no new file and no removed file.
- Every changed line is a line-number shift in a file the merge edited. The hit text is the same in each case:
  - `hel1230-drag-then-create-persists.spec.ts`: 83 → 84 (drag-handle `boundingBox`, POSITION-ONLY).
  - `hel909-output-picker-panel-sheet.spec.ts`: 124/186/187 → 126/187/188. This file is quarantined in `testIgnore` and does not run.
  - `hel1260-orphan-owner-repair.spec.ts`: 142/147 → 145/150 (grid-item rect before/after).
  - `hel1457-stale-tab-layout-save.spec.ts`: 44/120 → 45/124 (drag-handle, POSITION-ONLY).
  - `hel1028-layout-undo-redo-visual-revert.spec.ts`: 112/125/181/185 → 121/135/191/195 (handle boxes, container box).
- **The changed geometry assertion the sweep cannot see:** `hel1023`'s `GRID_MARGIN` constant (18 → 12). It has no sweep term, but it feeds the expected grid rects.
- No sweep hit file lost or gained hits from `hel1189`, `hel516` or `hel910`. They contain no sweep term.

**(b) Forced font states over the specs whose geometry or measured UI changed.**

Two kinds of spec are in scope:
- The dashboard grid moved to a 12px gutter, so every panel's width changed.
- The command bar became the meta row.

For coverage I ran the whole v2 sweep list plus `hel1512`: 32 files, 225 tests, on HEAD in each state.

| state | log | result |
| --- | --- | --- |
| fallback-only (stylesheet aborted) | `v6-merged-B-css-block.log` | 209 passed, 16 failed. All 16 are the known, expected set: 15 × `waitForWebFonts: web fonts did not settle` (hel1444 ×4, hel1574 ×4, hel1605 ×7; this mode removes the stylesheet that the wait requires) and hel1562 `:80` `waitForURL("/login")` (not geometry). This is the same set as v2/v3. |
| late swap, 1500ms on the stylesheet and each font | `v6-merged-C-late-1500.log` | 224 passed, 1 failed (hel1562 `:80`, the same non-geometry test). |
| first measurement in fallback (`FONT_FIRST_N=1`) | `v6-merged-D-fontfirst-n1.log` | 223 passed, 2 failed: hel1562 `:80` and hel1350 `:35` (light). 158 release lines, so the forced state was not vacuous. See the hel1350 note below. |
| one family held, then released after the first measurement: Fraunces / JetBrains Mono / Schibsted Grotesk | `v6-merged-E-hold-{Fraunces,JetBrains_Mono,Schibsted_Grotesk}.log` (10 grid/meta-row files: hel1023, hel1028, hel1260, hel1230, hel1457, hel1003, hel1398, hel1512, hel1275, hel1444) | 58 passed, 0 failed, in each of the 3 runs. 52 release lines in each. |

**Font-insensitive under the new gutter and meta row.** Each spec below passed in every state, and its values were identical or within margin:
- **hel1023** (grid rects, `GRID_MARGIN=12`; phone-stack scroll): green in B, C, D and all 3 holds.
- **hel1028** (undo/redo `expectBox`, which now enters edit mode first), **hel1260** (grid-item rect before/after), **hel1230 and hel1457** (drag handle, POSITION-ONLY): green in B, C, D and all 3 holds.
- **hel1003** (actions-menu row widths): green in every state.
- **hel1398** (control-bar canvas): `80.828125px` at 1504 and 1900, light and dark, in B, C, D and every hold.
- **hel1444** (converted spec, control bar vs main): `57px (main 57)` in all 16 measurements in C, D and every hold. In B it fails by design (`did not settle`).
- **hel1512**, min x-label gaps:
  - At 1504 (floor 14 + 0.05 epsilon):
    - hist10 is 14.85 in fallback-only and 16.75 in every other state.
    - **hist20 is 14.40 in fallback-only**. It is 16.20 in late, first-measurement and every hold, and 15.75 in the pre-merge baseline.
    - heatX is 90.61-91.36 and heat8X 87.53-88.36.
  - At 375 (floor 12), every value is identical in all states: heatX 14.57, heat8X 12.00, hist10 13.04, hist20 17.20. heat8X at 12.00 equals its floor in every state, including the pre-merge `hel1512-A-baseline.log`, so it is width-bound, not font-bound.
  - **New nearest-to-red font value:** hel1512 hist20 at 1504 in fallback-only, 14.40 against a floor of 14. It was hist10 at 14.85 before the merge.
- **hel1275, hel1065, hel1307, hel1306, hel1311, hel1351, hel588, hel572, hel1392, hel813, hel773, hel1574 (outside fallback-only), state-surface-contrast-guard and focus-presence-guard:** green in every state run.

**hel1350 (`:35`, "Compare trigger holds still") is not RED from the font swap.** Its spec and its measured UI did not change in this merge: it was last touched by HEL-1579, and the pipeline-editor sheet is not part of HEL-1576. It failed under the injector's *blocking* release:
- 1 of 2 tests in the D batch, then 1 of 6 in 3 solo re-runs (`v6-hel1350-D-fontfirst-n1-rerun{1,2,3}.log`: 2/2, 1/2, 2/2).
- **Mechanism, from the trace** (saved at `.concertino/scratch/HEL-1613/evaluator4/trace1350/`):
  - The poll's first callback measures `boundingBox` at `:158`.
  - The injector then releases the fonts and itself awaits `waitForFunction(link.sheet && document.fonts.length)` for **5.25s**, inside the spec's callback.
  - That consumes the whole 5000ms `expect.poll` budget, so the poll never takes a second sample (`Timeout 5000ms exceeded while waiting on the predicate`).
- **Discriminating run:** the same first-measurement-in-fallback state, with the release fired and *not* awaited (`FONT_FIRST_NOWAIT=1`, `fontfirst-nowait-preload.cjs.txt`). The swap then lands while the spec's own 300ms poll keeps sampling:
  - **8/8 passed** (`v6-hel1350-D-fontfirst-nowait-run{1..4}.log`, 2 passed each, a nowait release logged in every test).
  - It is also green in fallback-only and late-1500 here, and in all three states in v3.
- **Conclusion:** the poll is a stability wait that absorbs a real swap. The failure is the injector blocking the callback. It is recorded, and not converted (C3).
- **Limitation:** I did not log the per-sample y values. The nowait runs show the poll converges after a release during polling, but not by how many pixels the swap moved the trigger.

**hel1444 red/green pair, re-run** because its measured card width changed with the gutter. The mode is the same as cycle 3: `FONT_FIRST=1 FONT_FIRST_N=100000`, `-g "canvas floors"`, 1 worker.
- **Base spec:** `git show 67c434c6b:e2e/hel1444-…`, sha256 `92273fbc…`, identical to `38de7610a`'s copy. It ran from a scratch mirror of HEAD's `e2e/` with only that spec swapped in (`rundir=` in the header).
  - Log: `v6-redgreen-hel1444-base-RED.log`, `head=7e6967545…`, 7045/9952.
  - Result: **4 failed**, `exit=1`, with `58px (main 57)` in all 16 measurements and `Error: bar-two-w2 @1504 light: bar no taller than main`.
- **Converted spec:** run from the worktree with `FONT_FIRST_ASK_DELAY_MS=400`.
  - Log: `v6-redgreen-hel1444-converted-GREEN.log`.
  - Result: **4 passed (1.1m)**, `exit=0`, with `57px (main 57)` ×16 and 4 release lines.
- **Side effect:** the mirror has no `backend/.env`, so its user-registry teardown logged `e2e db: DATABASE_URL is unset` after the tests, the same as cycle 3's `v4` base run. The 4 throwaway `hel1444` users from that one run were therefore not deleted from the shared DB. This does not affect the RED evidence.

**(c) Full suite on HEAD, quiet machine.**
- Log: `v6-full-suite.log`.
- Header: `cwd=.../hel-1613 head=7e696754517249632d3eec32a80ee77ce81e005f dirty_code=0 DEV_PORT=7045 BACKEND_PORT=9952 DB=helio(shared,Flyway V135)`.
- Load: `loadavg_start=2.31 3.20 3.91`, `lock_acquired=21:30:37 loadavg=3.56 3.41 3.92`, `loadavg_end=3.47 3.68 3.97`.
- Command: `flock -w 3600 …/e2e.lock nice -n 19 npx playwright test --workers=2`.
- Result: **`312 passed (15.0m)`, `exit=0`, 0 `✘` lines.**

**Other checks:**
- AC1-AC5 are unchanged from evaluation-3, and the code is byte-identical.
- Constraints C1-C5 hold:
  - C1: no retry, timeout, skip or fixme was added. `retries: 0` is untouched.
  - C2: every cited run has a header with this worktree's path and ports and non-zero counts, at most 2 workers and `nice -n 19`.
  - C3: no spec converted without a red, and hel1350 was left unchanged.
  - C4 and C5: covered by the states above. They include per-family holds and are not a tuned timer alone.
- No scope creep.

### Phase 2: Code Review — PASS

- **Gates, run fresh on HEAD `7e6967545`:**
  - `npm run lint`: exit 0.
  - `npm run format:check`: exit 0 ("All matched files use Prettier code style!").
  - `npx tsc -p e2e/tsconfig.json --noEmit`: exit 0.
- **Gates not run:** the branch's own changed files match neither `frontend/**` nor `backend/**`, so `npm test`, the frontend build and `sbt testFull` do not apply. The HEL-1576 frontend changes come from `main` and are not this branch's diff.
- **Helper:** no code change since evaluation-3's review.

### Phase 3: UI Review — N/A

The branch diff against the base touches no UI-trigger file (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- **For `sweep.md`'s drift section,** record:
  - hel1023, hel1028, hel1260, hel1230, hel1457, hel1003, hel1398, hel1444, hel1512 and hel1275 as font-insensitive under the 12px gutter, with the values above.
  - The new nearest-to-red value: hel1512 hist20 at 1504 in fallback-only, 14.40 against a floor of 14.
  - The hel1350 blocking-injector note.
- **Tooling note:** `fontfirst-preload.cjs.txt` awaits the settle inside the spec's measurement call. Against any `expect.poll` with the default 5s budget, that can starve the poll. A future sweep should pair it with the `FONT_FIRST_NOWAIT` variant before calling such a failure RED.
- The 4 throwaway users left by the base-tree red run are test residue in the shared `helio` DB. You could clear them by pointing the mirror's teardown at the DB in a future red run.
- The evaluation-3 follow-up candidates (hel1579 accent-audit rate limit; hel1579 `:261` `document.fonts.ready`) still stand.
