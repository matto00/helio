## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: `4d597723aaede6351cbd0bb8dd592b2aea3f237e`. The base was resolved live as
`659eec3056a180d3accf83438a2c5e66de8152d6` (HEL-1326, now on main). The merge `951837c56` is clean:
`git diff 659eec305 HEAD` contains only this branch's own files (the e2e spec, the new RTL test and the change
dir). The two test files are byte-identical to cycle 2's `27dd24b81`. Cycle 3 itself changes only
`mutation-evidence.md`: the line refs are fixed and a "Cycle 3" section is added. Logs are in the session
scratchpad as `hel1327-eval3-*.log`.

### Phase 1: Spec Review — PASS
Issues: none.

The orchestrator asked me to probe four points.

1. **Does AC2 still discriminate on the merged tree? Which identity path does the delta take?**
   - HEL-1326 changed `selectMetricHistoryView`. When `baseline.metric !== undefined`, the baseline's own
     stored identity decides staleness. Otherwise it falls back to the returned point with the same
     `capturedAt`.
   - `PUBLIC_HISTORY.baseline` has no `metric` key, so the test's delta goes through the **fallback (points)
     path**. The executor says the fixture "already matches". That is true for the points path:
     `metricPoint` defaults to `{field: "amount", agg: "sum"}`, and `METRIC_CONFIG` resolves to the same pair
     (`fieldMapping: {}` → `aggregation.value: "amount"`, `agg: "sum"`). HEL-1326's change to
     `resolveServerMetricField` does not alter that resolution.
   - I probed the identity path with temporary copies of the test, deleted afterwards. With
     `baseline.metric = {amount, sum}`, both cases pass. With `baseline.metric = {other, sum}`, both fail on
     the `up 11%` delta role. So the identity path is live in this tree, and the fixture is simply
     legacy-server-shaped.
   - **This does not matter for AC2.** AC2 guards the route choice. The three discriminating assertions are
     the exact public args `("dash-1","panel-1","tok")`, `fetchOutputHistory` never called, and the DOM
     `2,222` / `▲ 11%` that exists only in the public payload. None of them depends on which staleness path
     renders the delta. HEL-1326's filtered-metric headline only engages when `filterActive` is true, and no
     filter is applied in this test.
2. **Is the AC2 mutation red genuine?** I deleted `historySource={historySource}` on the merged tree.
   - Both cases go red: `Expected: "dash-1", "panel-1", "tok"` / `Number of calls: 0` / `2 failed`.
   - A probe under the same mutation showed public calls `[]`, authenticated calls `[["out-1"]]`, and the DOM
     `Revenue1,204▲ 12% vs 7d` (the authenticated payload). The red is not vacuous.
   - Reverted. Green: 2/2.
3. **Is the e2e green in both themes?** Yes, `2 passed (22.6s)` on fresh servers running the merged tree.
   Because the backend now emits `baseline.metric`, the spec's delta text assertions (`▲ 12% vs 7d` → `vs 1d`)
   now pass through HEL-1326's identity path, and they hold.
4. **Did AC3/AC4 really not need re-recording?** The executor's reasoning is correct. `git diff f4601ba2e
   659eec305` touches none of `Sidebar`, `PanelList`, the grid, `panelGridConfig`, `useOutputHistory`,
   `outputHistoryCache` or the e2e support files. I re-ran the reds on the merged tree anyway:
   - AC3 count red: `Received ["http://localhost:6759/"]` at spec :323.
   - AC3 sentinel red (scratch copy without the count line): `Received: null` at copy :328.
   - AC4 new-wait red: `card width never changed from 333px after resizing the viewport to 1100px` at :85.
   - AC4 old wait under the same mutation: `1 passed` (the vacuous pass, reproduced).

   Every mutation was reverted, and `git status` is clean apart from this report.

Constraints C1–C5 are all honored. No product code ships in the branch diff against the live base.

### Phase 2: Code Review — PASS
Issues: none.

The executor committed with HUSKY=0 again, so I re-ran the hook gates on `4d597723a`:
- eslint: 0. prettier: 0. Frontend `tsc`: 0. e2e `tsc`: 0.
- All 16 node check scripts pass (repo-integrity, schemas, spec-structure, openspec + selftest,
  dependabot + selftest, cloud-run-cpu + selftest, scala-quality, test-temp-dir-hygiene + selftest,
  no-credential-leak + selftest, tokens + selftest).
- Root jest: 375/375. Frontend jest: 4643/4643 (includes HEL-1326's new suites). Frontend build: 0.
- `check:helio-mcp-types` still fails with `TS2554` at `src/index.ts:58`. The identical error reproduces in
  the main checkout at `659eec305`, so the stale `helio-mcp/node_modules` attribution still holds. This branch
  touches nothing under `helio-mcp/`.

### Phase 3: UI Review — PASS
Issues: none.

- Servers were started with `start-servers.sh <wt> 6759 9666 HEL-1327`, and `assert-phase servers` printed
  PASS.
- The listener cwds are this worktree's `backend/` (java 2050474) and `frontend/` (vite 2050941), both
  freshly started by this evaluation.
- The e2e passed in both themes.
- I stopped the servers by exact PIDs (2050941 2050911 2050474 2050003 2049961). Both ports are free.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PUBLIC_HISTORY` in `PublicDashboardViewerPage.history.test.tsx` could carry `metric: { field: "amount",
  agg: "sum" }` on `current`/`baseline`. That would mirror the current server shape, so the DOM assertion
  would run through HEL-1326's identity path rather than the legacy fallback. I verified it passes that way.
  The AC2 guard does not need it.

### Dev-DB users created by this evaluation (not deleted; no delete route, HEL-1301)
- b4e63a3a-8e6f-45d9-b773-5c202210c55b (green, light)
- 984adc3f-0b62-462a-acc4-9c214bb84d0e (green, dark)
- 6deb7abb-0b1a-40d4-b669-e2d8fcb8ae38 (AC3 red, count)
- 73cf84e3-9bd0-47d2-b0b8-bdf5997456ff (AC3 red, sentinel)
- c95c053f-c505-441e-8b3d-6934c15405d4 (AC4 new-wait red)
- f672500a-e350-44bd-97dd-8136882f753b (AC4 old-wait vacuous green)
