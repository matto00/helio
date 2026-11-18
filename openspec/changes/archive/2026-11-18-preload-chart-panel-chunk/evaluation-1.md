## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 25ff487ec3859e57d820ba71a8599df8ed30bfce (base ecefad62a, resolved live via resolve-review-base.sh).
Evaluator evidence (durable): /home/matt/Development/helio/.concertino/runs/HEL-1760/evidence/.concertino/scratch/HEL-1760/eval/

### Phase 1: Spec Review — FAIL

The code meets the ticket's intent. The chart chunk is now requested when an Output's metadata resolves as `chart`
(fetch, warm seed and public meta), not when the chart mounts. There is one shared `import()`, so there is one chunk and one
request. No timeout, sleep or retry was added. The change is frontend only, the tasks are all ticked and match the
diff, and there is no scope creep. Two problems remain:

1. **The spec delta promises behaviour the browser does not deliver.** This is the scenario "A failed preload does not
   break the chart" (`specs/frontend-code-splitting/spec.md`): "the chart panel still loads its chunk and renders on
   mount". I measured it in a real browser (`ui-abort.txt`): I aborted the first `ChartPanel.tsx` fetch on the chart dashboard. The result
   was `hits=1`, so the renderer's "retry" never reached the network: Chromium keeps the failed module record in its
   module map. The panel showed the error boundary "Something went wrong / Failed to fetch dynamically imported module", and
   `canvas=false`. The part that does hold: `pageerrors=[]`, so the swallowed rejection works. This is not a regression. On base,
   one failed fetch at mount gives the same error. But the spec states as a SHALL-backed scenario a recovery that
   does not happen. design.md's Risks section already says real-browser retry is unproven, and the spec should say
   the same.
2. **The AC 1 discriminating forcing is calibrated past HEL-1758's trace, against design D4's own guard.** See the
   calibration finding below. The red/green pair is real, but its green margin comes mostly from how the forcing was
   built, and the evidence as written overstates what a preload buys in CI.

Spec-delta scenarios I verified directly: a chart-free dashboard makes no `ChartPanel.tsx`/echarts request, and the
chart dashboard makes exactly one `ChartPanel.tsx` request with no console errors (`ui-checks.txt`). The chart code
stays out of the entry (see Phase 2).

CONSTRAINTS in workflow-state.md: none. Standing C1-C15 in tasks.md: no violation found in the diff or the evidence.
Probes were on 7192/10099 with page URLs checked. Servers were stopped with stop-servers.sh. The diff adds no
timeout or sleep.

#### Calibration finding: is the CI-shaped forcing faithful to HEL-1758's signature?

HEL-1758's record (main checkout, `archive/2026-11-18-flake-sweep-two-ci-backend/evaluation-1.md` lines 14 and 51,
run 44244750573 e2e (2)):

- Expect window: 874.40-879.40 s.
- Rows answered at +2.44 s.
- `ChartPanel.tsx` requested at +2.97 s, 0.53 s after the rows.
- echarts chain done at +3.86 s, so the chunk chain took **0.89 s**.
- Canvas visible "1-2 s later in the video", at about +4.9 to +5.9 s. The test failed, so it was after +5.0 s.

HEL-1758's skeptic-final-1.md line 29 says instead that the chain finished "about 1-1.5 s after the 5 s window
closed". That contradicts its evaluator's trace numbers. The trace itself was not available to re-read.

Of CI's request-to-canvas time (about 2-3 s), only about 0.9 s is chunk loading, which is the part a preload can
hide. The other 1-2 s is mount to canvas, which a preload does not touch.

The executor's revision-1 forcing (`ci-shaped-arithmetic.md`) uses `ROWS_HOLD=1900` and `CHUNK_DELAY=2800`. It took
the skeptic's reading (canvas at +6.0 to +6.5 s) and put the whole request-to-canvas time (about 3.3 s) into the
**chunk delay**. That makes the hideable part about 3x CI's 0.89 s chain. With the fix, canvas then lands at about
meta + 2.8 + 0.5 = about 3.9 s whatever the rows do, so green-after is close to built in. D4 forbids exactly this:
"never a large chunk delay that makes green-after a foregone conclusion". The executor's own first calibration
(1000 ms) was nearer CI, but it flaked on unfixed (RED, RED, green) and was never run on fixed code.

My independent runs. Unfixed means the browser was served `outputMetaCache.ts` with its preload call stubbed out
(`stubbed=1`). That is the base sequencing, and no source file was touched. Expectations were written before the runs
(`expectations.md`).

| Forcing | Unfixed (3 runs) | Fixed (3 runs) |
|---|---|---|
| E1, executor's numbers (rows 1900, chunk 2800) | RED x3; canvas 5.37-5.89 s | green x3; canvas 3.88-3.91 s |
| E2, CI-chain calibrated (rows 1900, chunk 700, CDP CPU 4x) | RED x3, by only 50-80 ms; canvas 5.07-5.08 s | green x3; canvas 3.77-4.43 s |
| E3, heavier than CI (rows 1400, chunk 700, CPU 6x) | RED x3; canvas 5.97-6.53 s | **RED x3**; canvas 5.38-5.88 s |

E2 matches the trace's shape. Request to chain done is about 0.9 s, matching CI's 0.89 s. Mount to canvas is about
0.9 s, which is at the low end of CI's 1-2 s. Under E2 the preload flips red to green 3 out of 3, with a 0.6-1.2 s
margin. So a faithful forcing does discriminate, and the fix closes the CI signature as that trace records it.

E3 shows the limit. In E3 metadata itself arrives at 2.1-3.0 s, later than CI's rows, so E3 is not CI-shaped. Even so,
once mount to canvas grows past about 1.5 s, the preload saves only 0.2-0.7 s and the test stays red. If CI's real
mount to canvas was near the "2 s" end, or if the skeptic's +6.0-6.5 s canvas reading is right, a preload alone may
not close the CI flake.

Conclusion: the fix is a genuine improvement, and AC 1 can be met with a faithful forcing (E2). The executor's E1
calibration overstates the hideable share, and the PR must not present E1's 1.1 s green margin as what CI will see.

Other ticket claims:

- **Gap re-measure.** Local unfixed shows 0-1 ms between rows answered and the `ChartPanel.tsx` request
  (`baseline-timeline-unfixed.txt`; my E1/E2 unfixed runs also show 0 ms). CI shows 0.53 s. The ticket's "~1.7 s" is in
  neither record, so the PR must say the ticket text was wrong, per the driver clarification.
- **Literal 6 s forcing.** RED before and RED after (`forcing-literal6s-*.txt`). It cannot discriminate, as D4 predicted.
- **40/40.** The executor's `repeat40-fixed.txt` shows 40 passed. I did not re-run it. As D4 notes, it is weak
  evidence locally.

### Phase 2: Code Review — PASS

Gates, run fresh in WORKTREE_PATH:

- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: root 66 suites and 579 tests passed. Frontend 812 suites and 9848 tests passed, exit 0. No "torn down"
  warning (grep count 0).
- `npm --prefix frontend run build`: exit 0.
- Logs: `eval/{lint,format,typecheck,jest,build}.txt` in scratch.

Bundle, checked from my own build (`bundle-eval.txt`, byte-identical to the executor's `bundle-fixed.txt`):

- The entry and modulepreload set for `index.html` is unchanged.
- For `app.html`:
  - `app` is -103 raw / -76 gzip.
  - `laneLayout` is +613 raw / +316 gzip. It now holds the memoised loader, `import("./ChartPanel-BY2vvn0l.js")` with
    `__vite__mapDeps`.
  - Three other chunks moved by ±1 byte.
- Net: **+510 B raw, +238 B gzip (gzip -9)**. This is under the 1 KB gzip call-out threshold.
- `ChartPanel-BY2vvn0l.js` has the same hash before and after. echarts appears only in non-entry chunks
  (`ChartPanel`, `useChartEntranceMotion`, `AdminUsagePage`), none of which is in the up-front set.

Code: the change is small, typed and DRY, with one specifier. Clear-on-reject is guarded by `pending === attempt`.
Unit tests are red first (`unit-red-unfixed.txt`, 3 failed on unfixed) and cover fetch, seed, public, the
non-chart kinds and memoisation. Comments carry the reason inline next to the HEL-1760 tag. No dead code.

### Phase 3: UI Review — PASS

Servers were started with start-servers.sh and assert-phase PASS. They were stopped with stop-servers.sh
(`STOPPED ports=7192,10099`).

- I confirmed the dev server served this worktree: `chartPanelModule.ts` returned 200 on 7192.
- Every chart and panel e2e spec file (23 files, every `e2e/*chart*`/`*panel*`) ran with `--workers=2 --retries=0`:
  **99 passed**, exit 0 (`e2e-chart-panel.txt`).
- Happy path renders.
- A chart-free dashboard makes no chunk request and logs no console errors.
- The chart dashboard makes 1 request and logs 0 console errors.
- A failed chunk fetch shows the existing error boundary with "Try again" and "Reload page". There is no blank screen
  and no unhandled exception. This matches base behaviour.

The change is not visual, so no breakpoint changes are expected.

### Overall: FAIL

### Change Requests

1. `openspec/changes/preload-chart-panel-chunk/specs/frontend-code-splitting/spec.md`, scenario "A failed preload
   does not break the chart": rewrite the THEN clause so it states only what is true. A failed preload raises no
   unhandled rejection or console error, and the chart panel behaves as it did before this change: its own load
   surfaces the failure through the existing panel error boundary. Say plainly that the browser caches a failed
   dynamic import per page, so this change adds no real-browser retry. Also drop "a failed preload leaves the renderer's
   own load to retry" from the requirement body (line 7), or qualify it as unit-level only. The alternative is to
   implement a real retry and prove it in a browser. The evaluator does not ask for that.
2. AC 1 evidence and the PR text:
   - (a) State that the revision-1 forcing's 2.8 s chunk delay is about 3x HEL-1758's measured 0.89 s chunk chain,
     because it put the whole request-to-canvas time into the chunk. Do not present its green margin as a CI
     prediction.
   - (b) Add a forcing whose chunk delay matches the trace's chain, with recorded red-before and green-after runs. Run it
     in the executor's own scratch with the numbers written down first, or cite the evaluator's E2 runs (durable paths
     above, `forcing-e2-all.txt`, rows 1900 / chunk 700 / CPU 4x, RED x3 to green x3).
   - (c) Report E3's limit honestly: under heavier load, where mount to canvas exceeds about 1.5 s, the preload alone
     stays red.
   - (d) Note the conflicting HEL-1758 readings of canvas time: the evaluator's 1-2 s after chain done, inside the
     window, against the skeptic's 1-1.5 s past the window.
   - (e) Update `ci-shaped-arithmetic.md` or add a note beside it so the scratch record matches.

### Non-blocking Suggestions

- `chartPanelModule.ts:4` says the module "Holds no React and no state", but it holds the `pending` memo. Reword it as
  "no React and no app state" or similar.
- Mount to canvas (about 0.9-1 s locally even unthrottled, from last module answered to canvas visible) is now the
  largest remaining share of the budget. HEL-1758's evaluation line 51 already suggests a per-frame probe of deferred
  ECharts init. That is worth a follow-up ticket if CI flakes again.
