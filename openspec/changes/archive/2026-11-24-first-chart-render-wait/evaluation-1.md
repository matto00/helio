## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `6214dd885053fd3dc53268bc023719aba9bca203` against live base `8abb826b745e81afc13419ea26772c71faf0652a`.
Binding: C1 (owner ruling `preload-chart-chunk-earlier`) and C2 (owner ruling `preload-plus-state-wait`). Both are
confirmed as `escalation.answered` with `answer_source: human` in `.concertino/runs/HEL-1651/events.jsonl` (lines 17 and 23).

Evaluator evidence (persisted):
- Timing probe spec (scratch, no product code changed): `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/.concertino/scratch/HEL-1651/eval-probe/preload-timing.spec.ts`
- Raw rows: `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/.concertino/scratch/HEL-1651/eval-probe/eval-preload-timing-all.jsonl`
- Summary: `/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/.concertino/scratch/HEL-1651/eval-probe/eval-preload-timing-summary.txt`

How the probe works: the dev server (where CI's e2e runs), the seeded M-world, and CDP CPU throttling. A MutationObserver
records `performance.now()` when a Table cell `500`, the Metric value `1,805` and a chart canvas first appear. Two arms:
- `fix`: the preload as shipped.
- `mut`: no-preload emulated without editing code. A `page.route` holds the `ChartPanel.tsx` module request until the
  first `GET /api/outputs/:id` response, which is the pre-HEL-1651 trigger point (`outputMetaCache.ts:97`). Holding
  ChartPanel.tsx also holds the echarts deps, because in dev they are requested only after it evaluates.
Both arms register the same pass-through route, so the routing overhead is equal.

| rate | arm | n | Table `500` | Metric `1,805` | Output metadata resp | canvas |
|---|---|---|---|---|---|---|
| 1x | preload | 4 | 1814 | 1857 | 1772 | **1882** |
| 1x | no preload | 4 | 1813 | 1845 | 1749 | 2184 |
| 4x | preload | 4 | 3870 | 4108 | 3649 | **4226** |
| 4x | no preload | 4 | 3716 | 3918 | 3401 | 4807 |
| 6x | preload | 6 | **5566** | **5931** | 5279 | 6170 |
| 6x | no preload | 6 | 4840 | 5035 | 4371 | 6293 |

(Each value is the mean in ms after navigation. At 6x the per-run Metric distributions do not overlap: preload min
5764 > no-preload max 5155.)

### Phase 1: Spec Review — FAIL

- AC root cause by probe: PASS. The serial startup waterfall is well evidenced (`probe-6x.txt`, `probe-findings.md`).
  The canvas box is non-zero (not HEL-1647), and the seed `/run` is awaited.
- AC red committed as `.txt`: PASS (`red-6x-chart-test.txt`, commit 4ed129174, before any fix code).
- AC state wait, no retries/no larger timeout on the asserted canvas: PASS. See the ceiling judgment below.
- AC 40/40 unthrottled: PASS. Executor: `final-full-40.txt`. Evaluator re-run: full spec `--repeat-each=2`, 8/8.
- AC 5/5 at 4x: NOT MET LITERALLY (`final-4x-n5.txt` 4/5). The one failure is the `:172` entrance lower bound, not the
  canvas wait. C2 scopes that flake out ("the :165 flake ... follow-up triage, out of scope"), so this is not counted as
  a defect. The PR must state it plainly.
- C2 "6x green N/N with both": met for the canvas wait. Executor `both-6x-n10.txt` 9/10 (the 1 failure is `:172`).
  Evaluator: chart test at `HEL1651_CPU_THROTTLE=6`, `--repeat-each=6`, 6/6.
- C2 "prove each half by red + mutation at 6x":
  - State-wait half: PROVEN. `mutation-b-no-wait-preload-kept-6x-n10.txt` 8/10 red at the canvas, then 10/10 with
    the wait.
  - Preload half: NOT PROVEN by the committed evidence. See the judgment below and CR2.
- **C1 "must not delay first table/metric render": VIOLATED at the owner's proof rate, and not measured by the
  executor (CR1).** At 6x the preload delays the first Table cell by about 730 ms (+15 %) and the Metric value by about
  900 ms. It also delays the Output-metadata response by about 900 ms. The canvas gets only about 120 ms earlier. At 4x
  the cost is about 150-190 ms (the distributions overlap) for a 580 ms canvas gain. At 1x the cost is nil and the
  canvas gain is 300 ms. The executor's long-task check (`longtask-fix.txt` / `longtask-mut.txt`) cannot detect this:
  both arms recorded zero long tasks on an unthrottled Ryzen 7600X, and it never measured time-to-first-Table/Metric.
  Probe-findings itself says the preload "competes with" the critical path. That competition is exactly what C1 forbids.
- C1 "extend HEL-1760's preload, no duplicate": PASS. `preloadChartPanelWhenIdle` (`chartPanelModule.ts:35-45`) only
  schedules `preloadChartPanel`, which goes through the one memoised `loadChartPanel()` `import("../ChartPanel")`. The
  build emits one `ChartPanel-*.js` (20,901 B) and one `useChartEntranceMotion-*.js` (651,301 B), matching the PR's
  byte figures (re-verified by the evaluator's build).
- C2 siblings: PASS. `waitForPanelGrid` (`e2e/support/panelGridReady.ts:24-31`) waits for the live grid to reach N
  items and then for the skeleton to unmount. That is a page-state wait. hel1573:405 and hel1584 :107/:505 are left
  unchanged except for the env-gated throttle hook, as C2 directs. `red-6x/10x-h1573-fit.txt` and `red-6x/10x-h1584.txt`
  support "not exposed". C1's "siblings red at 6x before" is superseded by C2.
- Scope: no creep. `cpuThrottle.ts` is a shared env-gated helper, unset = no CDP session.
- Planning artifacts: `design.md` still describes only the D2 decision tree. It does not record the two owner rulings,
  the idle preload, or the state wait (CR3).
- CONSTRAINTS honoured: C2 yes. C1 no (delay clause).

### Phase 2: Code Review — FAIL

Gates (fresh, run by the evaluator in `WORKTREE_PATH` after `cd frontend && nice -n 19 npm ci`):

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| `npm --prefix frontend run build` | 0 |
| `npm test`, root | 76 suites / 683 tests |
| `npm test`, frontend | 944 suites / 10,920 tests, all passed |

No backend changes.

- CONTRIBUTING / DESIGN mechanical rules: no violations found. Imports are not inline FQNs, the files are small, and
  there is no UI token use.
- Type safety, security, dead code: clean. `IDLE_START_TIMEOUT_MS` is named. The cancel paths are correct.
- **Tests meaningful: gap (CR2).** No test fails if `useChartPreloadOnMount()` is removed from `PanelList.tsx:44` or
  `DashboardRoute.tsx:29`. The only references are the hook's own unit test and its definition. The two jest files
  test the function and the hook in isolation, so the shipped wiring (the code-level form of mutation (a)) is
  unguarded.
- DRY / over-engineering (non-blocking): on `/dashboards/:id` both `DashboardRoute` and its child `PanelList` call the
  hook in the same commit. Both see `pending === null` and schedule two idle callbacks. The memo makes this harmless,
  but it is redundant.
- Error handling: `preloadChartPanel` swallows a rejection and `loadChartPanel` clears the memo for a retry. This is
  unchanged HEL-1760 behaviour, and correct.
- `e2e/support/cpuThrottle.ts`: validated integer, `1`/unset is a no-op, and invalid input throws. Follows the HEL1829
  precedent.

### Phase 3: UI Review — PASS

The change adds no visible UI. It changes when a chunk loads and adds an e2e wait.

Dashboard happy path verified in a real browser on the lane servers (7083/9990):
- 28/28 evaluator probe runs rendered the Table, Metric and chart canvas at 1x, 4x and 6x.
- hel1573 full spec 8/8 unthrottled.
- Chart test 6/6 at 6x.

No layout, breakpoint or accessible-name surface changed. Console output was not captured separately; the spec's own
recorder assertions passed. The servers were stopped with `stop-servers.sh` (`STOPPED ports=7083,9990`).

### Judgments requested by the orchestrator

1. **Mutation (a) green at 6x/8x/12x: inherent to the design, and still an evidence gap.** The state wait starts the
   5 s canvas budget at "Table cell visible". By then the chart's chunk and init remain, and in dev they fit within 5 s
   even at 12x whether or not the preload ran. So this pass/fail test cannot detect the preload by construction. That
   is a property of the C2 design, not an executor error. The preload's effect IS measurable, as time-to-canvas from
   `goto`: 1882 vs 2184 ms at 1x and 4226 vs 4807 ms at 4x (table above). At 6x it is only 6170 vs 6293. The
   pre-wait 5x A/B (6/10 vs 2/10) is weak support: one sample of 10 per arm, at a rate other than the owner's 6x.
   Two things would prove the preload half:
   - (a) A recorded timing/ordering probe at 6x. With the preload, the chart chunk request starts before the
     Output-metadata response. Without it, the request starts after. Time-to-canvas differs, N per arm.
   - (b) A jest wiring test that is red when either call site is removed (CR2).
   Neither exists in the committed evidence.
2. **The 15 s ceiling on the Table-cell state wait is consistent** with C2 and the precedent. C2 requires the canvas
   assertion to stay at the default 5 s, and it does (`hel1573-motion-grid-chart.spec.ts:124` is unchanged). The new
   explicit timeout applies to a different, state-type wait. It matches `waitForPanelGrid`'s 15 s default, which C2
   itself names as an acceptable page-state wait. The ticket's "no bigger timeouts" targets the sampled canvas
   assertion. A state wait needs a ceiling, and 15 s is the repo's established one. Not a weakening.
3. **`:172` entrance lower bound (out of scope): moderate exposure for this PR's CI.** Before this PR, a slow CI run
   failed at the canvas. Now the same slow runs proceed to `:172`, where every throttled failure has appeared (148.4
   and 59.8 at 4x, 131.7 at 6x; `:273` once at 12x). The comment at `:171` ("a slow host only lengthens a span, so a
   lower bound is not exposed") is contradicted by that evidence. Unthrottled it is 0/80 executor plus 8/8 evaluator,
   and CI's base rate for slow runs was low (a handful of sightings), so a single CI pass is likely but not assured. The
   PR's no-rerun AC (3.5) therefore carries real risk from an assertion the owner put out of scope. The follow-up
   should be filed before the PR merges, so a CI hit there is triaged and not rerun.
4. **Idle preload vs first table/metric render:**
   - At 1x: no delay.
   - At 4x: small and within noise.
   - At 6x: a clear delay of +730 ms Table and +900 ms Metric (CR1).
   - HEL-1760 coherence: one memoised import, one chunk. Coherent.
   - Prod-build long-task check: executed, but non-discriminating. Zero long tasks in both arms, unthrottled, and it
     does not measure render latency. On the production build the throttled table/metric latency remains unmeasured.
     The evaluator's attempt on a second port failed at UI login (backend origin is pinned to DEV_PORT), so it must be
     run on 7083 with the dev server stopped.
5. **Sibling assessment: correct.** `waitForPanelGrid` is a real state wait (grid count plus skeleton gone). Leaving
   hel1573:405 and hel1584 :107/:505 unchanged and saying so matches C2.

### Overall: FAIL

### Change Requests

1. **Measure and settle C1's "must not delay first table/metric render" on the production build.**
   - Measure time-to-first-Table-cell and time-to-Metric-value with and without the preload at 4x and 6x, N ≥ 6 per
     arm, via `npm run e2e:prod-build` on DEV_PORT 7083 with the dev frontend stopped.
   - The evaluator's scratch spec can be reused as-is. It already switches to hashed `ChartPanel-*`/
     `useChartEntranceMotion-*` chunks under `HELIO_E2E_PROD_BUILD=1` and holds both in the no-preload arm.
   - Commit the results as `.txt` evidence alongside the dev-server numbers above.
   - If production shows a delay: change when the preload starts so it cannot compete with the first data render, then
     re-measure. Examples: start the idle preload only after the first data panel has committed, or fetch without
     evaluating, via a `modulepreload` of the chunk.
   - If no start point removes the delay without discarding the gain: raise an ESCALATION. "Keep the preload" (C2)
     and "must not delay" (C1) then conflict, and the owner must choose.
   - Either way, the PR must state the measured dev-server cost at 6x (+730 ms Table / +900 ms Metric), not only
     "no long tasks".
2. **Prove the preload half per C2.**
   - Add a jest test that is red when `useChartPreloadOnMount()` is removed from `PanelList.tsx:44` (and one for
     `DashboardRoute.tsx:29`, or drop that call). For example, mock `chartPanelModule` and assert
     `preloadChartPanelWhenIdle` is called on mount.
   - Record the red with the call removed.
   - Commit a 6x timing/ordering probe as evidence: chunk request vs Output-metadata response, and time-to-canvas, N per
     arm, with and without the preload.
   - State in the PR that the canvas pass/fail test cannot detect the preload once the state wait exists, and why.
3. **Update `design.md` to the implemented behaviour.** Record the D2 outcome (host-slowness branch → owner rulings
   C1 then C2), the idle preload and its call sites, the Table-cell state wait with its 15 s ceiling, and the sibling
   decision.

### Non-blocking Suggestions

- Call the hook in one place only. `DashboardRoute` already covers `/dashboards/:id` before `PanelList` mounts, and
  `PanelList` alone covers `/dashboards`. Calling it in both schedules two idle callbacks per mount.
- File the `:172` entrance-lower-bound follow-up before merge, and correct its comment's claim that a slow host cannot
  shorten a span.
- The PR should say plainly that the "5/5 at 4x" AC is 4/5 because of `:172`, per C2.
