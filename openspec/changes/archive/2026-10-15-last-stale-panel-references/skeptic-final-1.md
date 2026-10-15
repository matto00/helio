## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `93f0255adc24aa8a4db8cf2de8e1370275446606`. Diff base resolved live with `resolve-review-base.sh` to `453c57f1e71b5a5a06214cde68cbfd0cd9f992e0` (exit 0). The cwd guard printed `READY`.

### What I verified (with evidence)

**AC1 (echarts spec):**
- The delta has exactly one `## MODIFIED Requirements` block, "Chart panel renders a live ECharts instance", with 0 `typeId` hits.
- HEL-1572's live delta (in its worktree) has only "Hover emphasis is subtle and respects reduced motion", so the two are disjoint.
- `openspec validate last-stale-panel-references --type change --strict` exited 0.
- I ran my own simulated `openspec archive --yes` on a scratch copy (`.../scratchpad/hel1614/skeptic-final-1/copy`). It exited 0 with "~2 modified". The archived canonical echarts spec then has 0 `typeId` hits, and HEL-1572's requirement is intact (line 307).
- I spot-checked the delta's claims against the code, and they match:
  - `PanelContent.tsx:177-207`: "Not run yet" with a Run pipeline button, then "No data available".
  - `chartDataOptions.ts:82-92,212`: heatmap and histogram return early; unmapped x falls back to column 0; with no y mapping, numeric columns are auto-detected.
  - `resolvePanelChartType`: stored type wins, then the Output's type, then line.

**AC2 (usePanelPolling):**
- The diff renames only the parameter, the doc comment, the guard and the deps array. In the test file, only test titles, variable names and literals changed; no `expect` line changed.
- `grep -rn typeId frontend/src/features/panels/hooks/` returns nothing.
- The only caller is `PanelCardBody.tsx:155`, which already passes `outputId`.

**AC3 (write-path-audit):**
- I checked each restated row against the code:
  - `panelService.ts:85-92`: `updatePanelsBatch` POSTs to `/api/panels/updateBatch`.
  - `PanelDetailModal.tsx:129-135` and `usePanelTitleEditing.ts:37` both use `accumulatePanelUpdate`. The modal's appearance payload is `{background, color, transparency}`.
  - `buildBatchRequest` returns `{fields, panels}`.
  - `OutputPicker.tsx:134` uses `swapPanelOutput`, which calls `patchPanelOutputId` (`PATCH {config:{outputId}}`).
- The archived copy has no "data binding" hit, and its panel-level scenario names updateBatch and Output swaps.

**AC4 (CLAUDE.md panels route):**
- Route tree: `PublicDashboardRoutes` is the only `dashboards/<id>/panels` route. It sits inside `optionalAuthenticate` (`ApiRoutes.scala:823-825`). `DashboardRoutes` and `DashboardContentsRoutes` have no panels GET.
- Live probe, with servers on 7046/9953 started and stopped through `scripts/concertino`, after a read-only sign-in as matt@helio.dev:
  - authenticated `GET /api/dashboards/a92a38a6.../panels` returned 200 (8 items), and `e690e243...` returned 200 (2 items);
  - the same requests unauthenticated returned `404 {"message":"Dashboard not found"}`.
- The old line was wrong and the new line is right; only that line changed in CLAUDE.md.
- I did not live-probe the claim that public or shared dashboards return 200 unauthenticated, because doing so needs a DB write. It rests on the `authorizeResourceWithSharing` code path.

**AC5 (dead code):**
- `git grep "segmented-btn|panel-detail-modal__segmented|metricOptions"` outside the change dir returns 0 hits.
- No dynamic `panel-detail-modal__${...}` class construction exists.
- The only production `<CollectionRenderer>` caller (`OutputPanelContent.tsx:245`) never passed `metricOptions`, so `buildMetricItem` produces the same output in production.
- The CSS lock test was updated honestly: the HEL-247 describe block for the removed selector is deleted, and the HEL-303 blocks are untouched.
- `npm run build` exited 0, and the built CSS has 0 `panel-detail-modal__segmented*` selectors.
- Each removed CSS block was a standalone rule set, not part of a grouped selector, so no other element's styling changes.

**Gates (fresh, this worktree):**
- Frontend jest, `--maxWorkers=3` under `nice -n 19`, on 12 suites (`usePanelPolling`, `PanelDetailModal.css`, `CollectionRenderer` ×3, `MetricRenderer` ×3, `PanelCardBody` ×4). `--listTests` shows the HEL-1614 worktree paths. Result: 12 suites / 103 tests passed.
- Root jest: 51 suites / 469 tests passed.
- `typecheck` and `lint` both exited 0.
- `prettier --check` on the changed frontend files passed.

**UI:** there is no intended visible change, so no screenshot judgment was needed. The UI-relevant part is the CSS removal, which I verified through the build output and source as instructed.

### Verdict: CONFIRM

### Non-blocking notes
- The pre-archive canonical `openspec/specs/echarts-chart-panel/spec.md` has 4 scenario headers retitled while their bodies are not. For example, line 19 is titled "A chart Output with no rows..." but its body still says "`typeId` is absent". Archive replaces the whole requirement block, and I proved that by simulation, so the merged state is clean. Even so, editing the canonical file directly ahead of the delta was unnecessary.
- Out of scope, still stale in the canonical echarts spec: the requirement "Chart annotation may be sourced from a bound DataType field" (line 224 after archive).
- Write-path row 7 omits the `type?` field that `buildBatchRequest` can carry. "6 calls from add/duplicate" counts refetch GETs as writes. Both were already noted by the evaluator.
