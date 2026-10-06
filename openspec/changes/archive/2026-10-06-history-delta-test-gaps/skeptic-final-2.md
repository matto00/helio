## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `4d597723aaede6351cbd0bb8dd592b2aea3f237e` (merged tree, includes HEL-1326 `659eec305`).
Cold review. The prior round's CONFIRM of `27dd24b81` was not relied on.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/history-delta-test-gaps/HEL-1327`.
- **Live base.** `resolve-review-base.sh` → `659eec3056a1…`, which equals origin/main HEAD (HEL-1326). The branch diff `659eec305...HEAD`,
  excluding the change dir, is exactly two files:
  `e2e/hel1275-metric-delta-sparkline.spec.ts` and `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.history.test.tsx`.
  - C1 holds. The diff touches no product file, no `OutputHistoryService`, no history schema, no `PublicDashboardRoutes*`, no scrubber, and none of `ci.yml`/`playwright.config.ts`/`.gitignore`.
  - The merge `951837c56` introduced nothing beyond main.
  - `e2e/support/isolateLivePage.ts` already exists on main.
- **HUSKY=0 bypass: nothing hidden.** I re-ran the hook gates on the changed files at HEAD:
  - eslint `--max-warnings=0` on the new test: 0.
  - prettier `--check` on both files: clean.
  - frontend `tsc --noEmit`: 0.
  - e2e `tsc -p e2e/tsconfig.json`: 0.
  - The bypassed `check:helio-mcp-types` covers `helio-mcp/`, and this branch does not touch it.
- **AC2 (public historySource RTL test).**
  - Green on real code: `Tests: 2 passed, 2 total` (scratchpad `hel1327-skf2-ac2-green.log`).
  - Mutation: deleted the `historySource={historySource}` line in `PublicDashboardViewerPage.tsx` → `Tests: 2 failed`, `Expected: "dash-1", "panel-1", "tok" / Number of calls: 0` at :143 (`hel1327-skf2-ac2-red.log`). Reverted with `git checkout`, and status was clean.
  - Exact args satisfy C5: `panel.id` "panel-1" ≠ `outputId` "out-1", there is no `expect.any`, and `resetHistoryCache`/`resetComparisonStore` run in `beforeEach`.
  - Checked for vacuity under HEL-1326's new paths:
    - `MetricOutputPanel.tsx` only uses `filteredMetric` when `filterActive`, and this test applies no filter.
    - If identity or staleness made `view.headline` null, the DOM would show the loaded-rows value (900), not `2,222`. A broken identity path therefore turns the test red; it cannot pass it.
    - `2,222` and `▲ 11%` exist only in the public payload.
- **Servers.**
  - Started via `start-servers.sh <wt> 6759 9666 HEL-1327`, and `assert-phase servers` printed `PASS servers`.
  - `readlink /proc/<pid>/cwd`: vite 2179784 runs in `<wt>/frontend` and java 2176188 in `<wt>/backend`.
  - Stopped by exact PIDs 2179784 2179642 2176188 2175167 2175114. Both ports are free afterwards.
- **E2E green (both themes).** `DEV_PORT=6759 nice -n 19 playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=1` → `2 passed (24.5s)` (`hel1327-skf2-e2e-green.log`).
- **AC3: independent mutation, different from the executor's.**
  - Mutation: `reloadDocument={destination.label === "Data Pipelines"}` in `frontend/src/app/Sidebar.tsx`, which makes the FIRST hop of the round trip a full load. The executor and evaluator only mutated the last ("Dashboards") hop.
  - Result: RED at spec :323, `Received ["http://localhost:6759/pipelines"]` (`hel1327-skf2-ac3-red-pipelines-hop.log`). The pre-existing `vs 1d` text assertions passed before it, which confirms the new assertion is the only one that catches the reload. Reverted.
- **AC4.**
  - Mutation: applied the `PanelList.tsx` freeze from `mutation-evidence.md` (freeze `gridContainerWidth` at the first non-initial measured width, without the console logging).
  - Result: RED at spec :85, `card width never changed from 333px after resizing the viewport to 1100px` (`hel1327-skf2-ac4-red.log`). Reverted, and status was clean.
  - I did not re-run the old-wait vacuous pass myself. Both `mutation-evidence.md` and `evaluation-3.md` report it reproduced (`1 passed`). It is supporting context; the AC's binding requirement is the red, which I reproduced.
- **resizeAndSettle logic.** The first loop iteration (1440 → 1440) correctly skips the change-poll. The 1100 hop and the restore to 1440 both poll for change and then settle. The `before` null precondition is asserted.

Logs are in `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1327-skf2-*.log`.

Dev-DB users created by this review (shared dev DB, not deleted, no delete route):
- 4f9759f9-0028-4671-97e3-05c44381bfa0 (green, light)
- 62c48b55-cb76-4c24-89d5-5c707012d551 (green, dark)
- e8fb3dcd-fa34-4123-a6f9-466cb427c40b (AC3 red)
- 21d2e698-3bd2-4f32-9018-930475831464 (AC4 red)

None of them is matt@helio.dev.

UI design judgment: not applicable. This is a test-only change with no rendered UI diff.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-3.md` is untracked in the worktree. The orchestrator should commit it with the delivery.
- The evaluator's suggestion to add `metric: {field:"amount", agg:"sum"}` to `PUBLIC_HISTORY` still applies: it would route the DOM assertion through HEL-1326's identity path. AC2 does not need it.
