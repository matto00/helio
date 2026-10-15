## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 453c57f1e71b5a5a06214cde68cbfd0cd9f992e0 (change dir untracked, planning artifacts only).
Scratch: /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/skeptic-design-2/

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/last-stale-panel-references/HEL-1614`.
- Round-1 CR1 (write-path-audit transport) is addressed. The delta scenario now names `POST /api/panels/updateBatch` for staged title/appearance edits and `PATCH /api/panels/:id` for Output swaps. Decision 2 covers rows 7/8, payload details 7/8, row 9 (`OutputPicker.tsx`), call-volume totals, Source Locations and the L176-180 Key observation. The cited files exist: `panelPayloads.ts:125` (updateBatch wire shape), `panelService.ts:89`, `usePanelUpdatesFlush.ts`, `grid/usePanelTitleEditing.ts`, `OutputPicker.tsx`. The stale canonical lines are confirmed at write-path-audit L25, L125, L166, L170, L179 and L192.
- Round-1 CR2 (echarts overclaim) is addressed:
  - The x/y fallback is now scoped to line/bar/scatter/pie. It matches `chartDataOptions.ts:82-85` (heatmap/histogram branch out before `resolveDataColumns`), the scatter-with-no-yCol fall-through to auto-detect (`:103` guard `yCol !== -1`), and pie's `resolvePieValueColumn`, which takes the first numeric column.
  - `chartType` was dropped from the "comes from the Output" list.
  - The precedence matches `resolvePanelChartType.ts:13-16`.
  - The non-aggregating gating matches `ChartOutputPanel.tsx:88,101-103`.
  - The loading skeleton `aria-label="Loading data"` matches `OutputPanelContent.tsx:119`.
  - The footnote lives in `ChartRenderer.tsx`, and the annotation is passed at `ChartOutputPanel.tsx:150`.
- Round-1 CR3 is addressed: Decision 3 and task 3.1 now rename the test's `typeId` variable and titles too, so the hooks-dir grep can come back empty. There are 12 `typeId` hits under `hooks/` today, all in `usePanelPolling.ts` and its test.
- Mechanism re-tested on a scratch copy of `openspec/`:
  - `openspec validate last-stale-panel-references --type change --strict` -> valid (rc=0).
  - After the lockstep retitle of the three scenarios in canonical and delta, validate is still rc=0.
  - `openspec archive --yes` -> `~ 2 modified`, archived.
  - The "Hover emphasis is subtle and respects reduced motion" block is byte-identical pre/post (`diff` rc=0, HEL-1572 stays disjoint).
  - `## Write Path Reference` survives.
- **The post-archive echarts spec still contains `typeId`** (scratch copy, line 9): "No panel kind has a `type: \"chart\"` value or a `typeId`/DataType binding". It comes from the delta's own requirement text (`specs/echarts-chart-panel/spec.md:4`). See CR1.

### Verdict: REFUTE

### Change Requests

1. **AC1 and task 1.2's verification cannot pass as planned. The delta re-introduces the string `typeId`.**
   - Ticket AC1 says "The echarts-chart-panel spec no longer mentions `typeId`". Task 1.2 verifies with `grep -n typeId openspec/specs/echarts-chart-panel/spec.md` is empty.
   - The restated requirement in `openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:4` says "No panel kind has a `type: "chart"` value or a `typeId`/DataType binding". After archive, the canonical spec therefore still mentions `typeId`. I reproduced this with a simulated archive on a scratch copy: the grep hits line 9.
   - The grep also fails at task-1.2 time, before archive. Requirement 1's body in the canonical spec only changes when the delta is applied at archive. Until then, canonical L20 still holds the original `typeId` sentence.
   - Fix both:
     - (a) Reword the delta sentence so it doesn't name `typeId`, or drop the negative sentence entirely. For example: "A chart is not a panel kind; it is an `output` panel bound to a `chart` Output." The positive statement already carries the model.
     - (b) Restate task 1.2's verification so it can actually pass. Grep the delta file (and the Purpose line in canonical) now, and grep the canonical spec after a simulated archive on a scratch copy (task 1.3). Don't grep canonical pre-archive.
   - Otherwise the executor either hits a red check it can't clear or "fixes" it by editing canonical requirement 1 directly, which bypasses the delta.

### Non-blocking notes

- The requirement says that when the Output config has an `aggregation` and the *resolved* type is bar/line/pie, the chart aggregates. `chartAggregationSpec` (`history/chartOverlay.ts:47-48`) also returns null when the *Output's* `config.chartType` is non-aggregating. So in the legacy case, a scatter+aggregation Output with a panel-level `bar` override renders raw rows. This is a legacy-only edge that backend validation prevents on write. Consider adding "and the Output's own `config.chartType` is not non-aggregating", or record it in evidence.md.
- The retained scenario title "Chart panel with unknown chartType falls back to line" is broader than its body, which correctly scopes the fallback to the Output-config path (an unknown stored `appearance.chart.chartType` has no fallback, per `resolvePanelChartType.ts:14`). It's acceptable because the body is precise, but it could join the lockstep retitle set.
- Design cites `OutputPanelContent.tsx:164`; the `<ChartOutputPanel` render is at `:166`. This is cosmetic.
- Round-1 notes still apply: list CLAUDE.md `.../panels/:panelId/rows` and the unlisted panel config PATCH writes as follow-ups in the PR, and don't describe `usePanelPolling` as live behaviour (`refreshInterval` is null when hydrated from the backend).
