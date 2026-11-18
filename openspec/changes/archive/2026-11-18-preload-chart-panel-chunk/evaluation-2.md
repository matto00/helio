## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 5fd8f26091e6443dbced77e4e34ef99743fbdeb1, which is the cycle-1 commit 25ff487ec plus the fix-up 5fd8f2609. The base, ecefad62a, was resolved live.
Evaluator evidence (durable): /home/matt/Development/helio/.concertino/runs/HEL-1760/evidence/.concertino/scratch/HEL-1760/eval2/

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are resolved.

- **CR1 (failed-preload wording).** The spec delta now promises only what the browser does:
  - no unhandled rejection or console error from the preload;
  - the chart behaves as it did before this change, so a failed chunk fetch shows the existing panel error boundary;
  - the browser caches a failed dynamic import, so no browser-level retry is added;
  - clear-on-reject is described as unit-level only.

  This matches the real-browser measurement in cycle 1 (`ui-abort.txt`: `hits=1`, error boundary shown, `pageerrors=[]`).
- **CR2 (forcing calibration and honesty).** `ci-shaped-arithmetic.md` and `pr-evidence.md` now cover what was asked:
  - revision 1's 2.8 s chunk delay is called about 3x CI's 0.89 s chain, and its margin is flagged as not a CI prediction;
  - HEL-1758's two conflicting canvas readings are both recorded;
  - the E3 / CPU 6x limit is stated;
  - a forcing calibrated to the CI chunk chain is added (rev 6).

  Each revision (r2-r6) wrote its numbers before running. The failed calibrations are kept, not discarded: r2 and r5 each had a fixed run that went red. That is honest record-keeping.
- **Gap.** `pr-evidence.md` says plainly that the ticket's "~1.7 s" is wrong: the gap is 0 ms locally and about 0.5 s in CI.
- **Flake list.** This is a driver action after merge, as the ticket describes.
- **Constraints.** `workflow-state.md` CONSTRAINTS is empty. C1-C15 were honoured: probes ran only on 7192/10099 with URLs checked, all scratch went to `.concertino/scratch/HEL-1760/`, and servers were stopped with `stop-servers.sh`.

#### Is rev 6 a genuine discriminating pair or a knife-edge?

Rev 6 settings: rows answer held until an absolute 3.2 s after goto, chunk delayed 700 ms, CPU throttled 4x.

I re-ran it independently, 5 unfixed and 5 fixed, interleaved. "Unfixed" means the browser received `outputMetaCache.ts` with the `preloadChartPanel()` call stubbed out (`stubbed=1`). I also shifted the rows time by ±300 ms (3 + 3 runs each) to test how sensitive the split is. My expectations were written before the runs (`expectations.md`).

| Rows released at | Unfixed (canvas, s) | Fixed (canvas, s) |
|---|---|---|
| 2.9 s | RED 3/3 (5.11, 5.11, 5.12) | green 3/3 (3.93-4.96) |
| 3.2 s (rev 6) | RED 5/5 (5.11-5.29) | green 4/5 (3.99, 4.04, 4.75, 4.88); **RED 1/5 at 5.10** |
| 3.5 s | RED 3/3 (5.43-5.61) | green 3/3 (4.80-4.99) |

Adding the executor's own runs (unfixed 5.12-5.23 RED 3/3, fixed 3.81-4.68 green 3/3):

- Unfixed: **RED in 14 of 14 runs.**
- Fixed: **green in 14 of 15 runs.**
- At the calibrated point, the median fixed-vs-unfixed shift is about 0.46 s (5.21 vs 4.75).

**Judgment: a genuine discriminating pair, but a narrow one, not a knife-edge.**

- The unfixed arm is tight (a spread of about 0.2 s at each rows time). It stays red when the rows time moves 300 ms either way, so its red is not an accident of one rows setting. Unfixed canvas follows the chunk request time plus about 1.7-1.9 s.
- The fixed arm moves the canvas earlier by 0.2-1.2 s per run.
- The margins are thin on both sides. Unfixed misses the window by 0.1-0.6 s. Fixed clears it by 0-1.2 s, and failed once: in that run the metadata, and with it the preload, arrived late (2.5 s) and mount-to-canvas took 1.5 s.

A thin margin is what this signature should look like. CI itself only flaked, and at CI's shape a preload can hide only the roughly 0.9 s chunk chain. The pair supports this claim: the preload moves the canvas earlier by about 0.5 s at CI-like load, which turns the CI-shaped miss into a pass in the large majority of runs. It does not support "the flake is closed". `pr-evidence.md`'s Limit paragraph already says this, so no CR is raised. The one fixed red is a disclosure item for the PR (see Non-blocking Suggestions).

### Phase 2: Code Review — PASS

The only code change since cycle 1 is a comment, `chartPanelModule.ts:3` ("no app state (only the pending-import memo)"), which resolves the cycle-1 suggestion.

Gates, re-run fresh after the executor's edits in WORKTREE_PATH:

- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: root 66 suites / 579 tests passed; frontend 812 suites / 9848 tests passed. No "torn down" warning (grep count 0).
- `npm --prefix frontend run build`: exit 0.

Bundle (`bundle.txt`) is **byte-identical** to cycle 1's fixed measurement:

- echarts is in no entry or modulepreload chunk;
- the `ChartPanel` chunk has the same hash as base;
- the up-front set grows by +510 B raw and +238 B gzip, under the 1 KB gzip threshold.

### Phase 3: UI Review — PASS

- **Servers.** Started with `start-servers.sh` (assert-phase PASS) and stopped with `stop-servers.sh` (`STOPPED ports=7192,10099`).
- **E2E (C12).** I ran all 23 chart and panel spec files (every `e2e/*chart*` and `*panel*`) with `--workers=2 --retries=0`: **99 passed**, exit 0 (`e2e-chart-panel.txt`).
- **Cycle-1 UI checks.** These still hold, because no runtime code changed:
  - a dashboard with no chart makes no chunk request;
  - a chart dashboard makes one request and logs no console errors;
  - a failed chunk fetch shows the existing error boundary with no unhandled rejection.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- Add the evaluator's rev-6 re-run to the PR's AC 1 paragraph: unfixed RED 5/5; fixed green 4/5 with one red at 5.10 s when metadata arrived at 2.5 s. Pooled with the executor's runs that is 14/14 RED unfixed and 14/15 green fixed. Also add the ±300 ms rows-shift probe. The PR currently says only "fixed green 3/3", so it should carry the 1-in-15 rate as the honest one.
- The executor's `forcing.spec.ts` VERDICT line prints `ROWS_HOLD=0` but not `ROWS_AT`, so the rev-6 output files do not record their own rows setting. The setting is recoverable from `ci-shaped-arithmetic.md`. Scratch only.
