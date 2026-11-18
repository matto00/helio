## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 5fd8f26091e6443dbced77e4e34ef99743fbdeb1. Base resolved live with `resolve-review-base.sh`: ecefad62a191e68d32fdf333acb695f296671f1e.
Evidence dir (durable): /home/matt/Development/helio/.concertino/runs/HEL-1760/evidence/.concertino/scratch/HEL-1760/skeptic/
Servers: started with `start-servers.sh` on 7192/10099 (`assert-phase servers` PASS), stopped with `stop-servers.sh` (`STOPPED ports=7192,10099`). Every probe printed `url=http://localhost:7192/dashboards`.

### What I verified (with evidence)

**Diff (read in full).** The diff adds `chartPanelModule.ts`, which holds one `import("../ChartPanel")`, memoised, with the memo cleared on rejection. `preloadChartPanel` swallows a failure. `ChartRenderer`'s `lazy()` now goes through this module. The preload is called from three places:
- `outputMetaCache.noteKind`, used by both `fetchOutputMeta` and `seedOutputMeta`;
- `publicDashboardService.fetchPublicOutputMeta`.

The diff touches no component, no e2e test, no timeout and no backend file. It matches design D1/D2. Every call site of `fetchOutputMeta`/`seedOutputMeta` is one of the four D2 lists (`useOutputMeta`, `useDashboardMeta`, `usePanelRunRefresh`, `warmRestore`).

**Mechanism (my own probe, `probe.spec.ts`).**
- Setup: the rows response is held to 4.0 s, with no throttle. "Unfixed" means `preloadChartPanel()` is stripped from the served `outputMetaCache.ts` by route interception. No file is edited.
- Fixed run: `ChartPanel.tsx` is requested at the moment the metadata answers (505 ms and 781 ms), long before the rows (4.1 s).
- Unfixed run: the request comes only when the rows answer (4118 ms and 4081 ms).
- Both runs make exactly one chunk request (`chunkHits=1`), with `errors=[]`. Files: `mech-*.txt`.
- This proves the spec scenario "chunk requested while rows pending".
- Locally, without a throttle, the preload gains almost nothing: rows to canvas takes about 0.85 s either way. The gain appears only when the chunk chain is slow, which is what `pr-evidence.md` says.

**AC 1, forcing red before / green after (independent reproduction).**
- I ran the executor's rev-6 CI-shaped shape myself: CPU 4x, rows released at 3.2 s, chunk +700 ms, 5 s window. Runs were interleaved.
  - Unfixed: RED 3/3, canvas at 5145, 5187 and 5096 ms.
  - Fixed: green 3/3, canvas at 4698, 4678 and 4646 ms.
  - Files: `r6-{unfixed,fixed}-{1,2,3}.txt`.
- This matches the executor's records (RED 5.12-5.23 s, green 3.81-4.68 s) and the evaluator's 14/14 RED and 14/15 green.
- The literal 6 s run is recorded red both ways: 7.97 s and 7.36 s (`forcing-literal6s-*.txt`). `pr-evidence.md` says plainly that it cannot discriminate, as the driver clarification requires.

**AC 2, 40/40.** I ran `hel1573-motion-grid-chart.spec.ts -g "chart:" --project=dev --repeat-each=40 --workers=2 --retries=0` under nice 19: **40 passed, 0 failed, exit 0** (`repeat40.txt`).

**AC 3, bundle.**
- `npm --prefix frontend run build` exits 0.
- I ran `bundle.sh` over the up-front set (entry scripts and modulepreloads of `index.html` and `app.html`). Its output is byte-identical to the executor's `bundle-fixed.txt`.
- Delta against `bundle-base.txt`: +510 B raw, +238 B gzip. That is under the driver's 1 KB gzip threshold.
- No up-front chunk mentions echarts (`!!` count 0, before and after).
- `ChartPanel-BY2vvn0l.js` has the same hash in base and fixed. Exactly one chunk, the modulepreloaded `laneLayout`, references it.
- Base-side limit: the base numbers come from the executor's `dist-base/`. I did not rebuild base myself. The unchanged `ChartPanel` hash and the matching set of untouched chunks corroborate that it is the base build.

**AC 4, flake list.** There is no in-repo list. This is a driver action after merge, as the ticket's driver context says. It is recorded in `pr-evidence.md`.

**Gap re-measure.** The executor measured 0 ms locally and cites about 0.5 s from the CI trace. `pr-evidence.md` says the ticket's "~1.7 s" was wrong, as the clarification requires. My unfixed probe agrees: chunk request and rows answer land within 2 ms of each other.

**Gates (run fresh).**
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: exit 0.
- Targeted jest (chartPanelModule, outputMetaCache, publicDashboardService, ChartRenderer, ChartPanel, warmRestore): 20 suites / 153 tests passed, no "torn down" warning.
- I relied on the evaluator's pasted full-suite counts (812 suites / 9848 tests).

**C12, chart and panel e2e.** I ran all 23 `e2e/*chart*`/`*panel*` spec files with `--workers=2 --retries=0`: **99 passed, exit 0** (`e2e-chart-panel.txt`).

**UI / design.**
- The diff changes nothing visual: no component, CSS or token.
- Screenshot `chart-fixed.png`: the chart, metric and table panels render normally, and the console has no errors.
- I did not toggle the light/dark theme, because nothing themable changed.
- The no-chart and failed-preload behaviour was covered by the evaluator's cycle-1 UI checks (`ui-checks.txt`, `ui-abort.txt`). No runtime code has changed since then. I did not re-run those checks.

**Spec delta.** The wording on a failed preload now promises only what the browser does: no unhandled rejection, existing error boundary, no real-browser retry, and clear-on-reject proven at unit level only. This is consistent with the code and its unit test.

### Verdict: CONFIRM

### Non-blocking notes
- The discriminating margin is thin: unfixed misses the window by 0.10-0.19 s in my runs, and fixed clears it by 0.30-0.35 s. The forcing went through six calibration revisions before a clean pair appeared. Each revision wrote its expectations first and was kept in the record, and two independent re-runs (the evaluator's and mine) reproduce the split, so I accept it as real. It still shows that the preload hides only the about 0.9 s chunk chain. It does not show that the CI flake is closed. The PR should carry the evaluator's pooled rate (14/14 RED, 14/15 green) and the Limit paragraph, not "3/3".
- I did not exercise the public / share-token preload in a real browser. It is unit-proven, and the code is a one-line `if` in the service.
- `outputMetaCache` now imports from `ui/renderers`, a state-to-ui dependency. It is documented and harmless because the loader holds no React, but a later move of the loader to a neutral `lib/` location would be cleaner.
- `evaluation-2.md` is untracked in the worktree and needs committing with the delivery artifacts.
