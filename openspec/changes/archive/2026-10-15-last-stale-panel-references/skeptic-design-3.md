## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 453c57f1e71b5a5a06214cde68cbfd0cd9f992e0 (the change dir is untracked; this is planning artifacts only).
Scratch: /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/skeptic-design-3/

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/last-stale-panel-references/HEL-1614`.
- **Round-2 CR1 is fixed.** `grep -n typeId` on both delta files is empty. The delta requirement no longer names `typeId`. Task 1.2 now greps the delta and the Purpose line, and task 1.3 greps the post-archive spec, so the check is achievable.
- **Mechanism, re-tested myself on a scratch copy of `openspec/`** (openspec 1.10.0):
  - `validate --strict` returns rc=0 on the change as written.
  - I applied the four Decision-1 retitles in lockstep to the canonical spec and the delta. `validate --strict` still returns rc=0.
  - `openspec archive --yes` reports `Totals: ~ 2` and archives.
  - Post-archive, `grep -n typeId` on the echarts spec returns rc=1 (empty).
  - The "Hover emphasis is subtle and respects reduced motion" block (14 lines, extracted by awk) is byte-identical before and after (`diff` rc=0).
  - HEL-1572's delta has exactly one header, which is that same requirement.
  - write-path-audit: the only diff is L25, and `## Write Path Reference` survives.
- **Chart type precedence.** The claim matches `resolvePanelChartType.ts:13-17`. The aggregation gating on the Output's own `config.chartType` matches `chartOverlay.ts:47-48`.
- **usePanelPolling.** `typeId` appears at L4, 7, 10, 15, 25 and 63. The sole caller is `PanelCardBody.tsx:155`, which passes `outputId`.
- **CLAUDE.md:155.** The text is as quoted.
- **Dead code.**
  - Non-test `metricOptions` hits are all inside `CollectionRenderer.tsx` itself.
  - `segmented` outside the CSS files hits only `PanelDetailModal.css.test.ts:193-202` and an unrelated e2e comment.
- **write-path-audit.** The stale lines are confirmed at L25, L71-72, L125, L166, L170, L179 and L192. `panelService.ts:89` posts to `/api/panels/updateBatch`.
- **Empty-rows scenario: NOT confirmed (see CR1).**
  - `usePanelData.ts:357-358` sets `noData = paginationEntry != null && !isLoadingMore && rows.length === 0 && !error`. `neverMaterialized` is `noData && materialized === false`.
  - `PanelContent.tsx:178-206` returns early on these flags, before the `isOutputPanel` dispatch at L210:
    - `noData && neverMaterialized` renders "Not run yet" plus a Run pipeline button.
    - `noData` alone renders "No data available".
  - `PanelCardBody.tsx:144` passes `effectiveNoData = noData && !filterActive`. Per its own comment (L137-142), `filterActive` is only ever true for table panels.
  - Pinned by: `PanelContent.test.tsx:265`, `PanelCard.filterEmptyState.test.tsx:184`, `PanelGrid.test.tsx:398-399`.
  - So a chart Output with no materialized rows never reaches `OutputPanelContent`/`ChartOutputPanel` in the grid, and no ECharts instance mounts.

### Verdict: REFUTE

### Change Requests

1. **The echarts delta's empty-rows scenario restates a false behaviour.** In `specs/echarts-chart-panel/spec.md`, the scenario now titled "Unbound chart panel shows an empty default chart" (Decision 1 retitles it "A chart Output with no rows renders an empty chart frame") says:
   - WHEN "the bound `chart` Output's metadata has loaded but it has no materialized rows"
   - THEN "an ECharts instance still mounts with an empty frame ..."

   In the running grid and detail-modal paths, `PanelContent.tsx:178-206` intercepts this case before any chart mounts:
   - "Not run yet" when the node was never materialized.
   - "No data available" when it ran and returned zero rows.

   `chartDataOptions.ts:79` returning `{}` is real, but it is only reachable when `ChartOutputPanel` receives an empty row set while `noData` is false, for example rows narrowed to zero client-side by the cross-filter fallback (`OutputPanelContent.tsx` `filteredRawRows`). Shipping this scenario would author a new stale claim, which is exactly what AC1/AC3 exist to remove.

   Revise the delta scenario, its planned retitle in design.md Decision 1 (and the lockstep list in task 1.2), and the design.md "No rows" fact bullet. Have them state what `PanelContent` actually renders:
   - a never-run Output shows "Not run yet";
   - a run with zero rows shows "No data available";
   - optionally, a chart whose loaded rows are narrowed to zero at render time mounts an empty frame. Only claim this if the executor confirms it by reading `OutputPanelContent`/`ChartOutputPanel`, or with an existing test.

   Cite the test lines above. Task 1.1 should record the command and output for whichever wording lands. The rows-loading case also renders the `Loading data` skeleton (`PanelContent.tsx:149-157`), not only the metadata-loading case. Consider broadening the loading scenario's WHEN to cover both.

### Non-blocking notes

- design.md Decision 1's heading says "a direct retitle of three scenario titles", but its body and task 1.2 list four. Fix the heading so the executor isn't left to choose.
- Round-1/2 notes still stand:
  - List the CLAUDE.md `.../panels/:panelId/rows` line and the unlisted panel config PATCH writes as PR follow-ups.
  - Don't describe `usePanelPolling` as live behaviour (`refreshInterval` is null when hydrated from the backend).
