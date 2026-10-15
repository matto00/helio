## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: HEAD 453c57f1e71b5a5a06214cde68cbfd0cd9f992e0. The change dir is untracked, so this review covers planning artifacts only.
Scratch: /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/skeptic-design-4/

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/last-stale-panel-references/HEL-1614`.

- **Round-3 CR1 (false empty-rows scenario) is fixed.** The delta scenario now says:
  - a never-materialized Output shows "Not run yet";
  - a run that returned zero rows shows "No data available";
  - an empty frame is drawn only when loaded rows are narrowed to zero at render time.

  I checked this against the code:
  - `PanelContent.tsx:178-206` returns those two states before the `isOutputPanel` dispatch.
  - `PanelCardBody.tsx:144` sets `effectiveNoData = noData && !filterActive`. `filterActive` can only be true for tables (comment at L137-142), so a chart's server or viewer filter that returns zero rows also lands on "No data available". That matches the scenario.
  - `OutputPanelContent.tsx:138-141` passes the client-fallback `filteredRawRows` (which can be `[]`) to `ChartOutputPanel` (L166-173).
  - `chartDataOptions.ts:79` returns `{}` for empty rows.
  - `buildChartOption.ts:48-49` has the default `xAxis: {type:"category", data:[]}` / `yAxis: {type:"value"}`.

  The empty-frame clause is therefore grounded. Task 1.1 still requires the executor to record evidence for it.
- **Loading scenario broadened.** It now covers both the rows-loading skeleton (`PanelContent.tsx:149-157`) and the metadata-loading skeleton (`OutputPanelContent.tsx:117-122`). Both carry `aria-label="Loading data"`.
- **Decision 1 heading** now says "four", which matches its body and task 1.2. The round-3 note is resolved.
- **Chart type precedence.** The text matches `resolvePanelChartType.ts:13-17`: stored appearance, then a recognised Output `config.chartType`, then `line`.
- **Mechanism, re-run by me on the current delta** (scratch copy of `openspec/`, openspec 1.10.0):
  - `openspec validate last-stale-panel-references --type change --strict` returns rc=0, both in the worktree and in the scratch copy after the four lockstep retitles.
  - `openspec archive --yes` reports `Totals: + 0, ~ 2, - 0, → 0`.
  - After archive, `grep -n typeId` on the echarts spec returns rc=1 (empty).
  - The "Hover emphasis" requirement block is byte-identical before and after (`diff` empty).
  - The write-path-audit `## Write Path Reference` section is byte-identical through archive, so direct edits there survive.
  - The resulting scenario titles are as planned.
- **HEL-1572 is disjoint.** Its delta has exactly one header: `### Requirement: Hover emphasis is subtle and respects reduced motion`.
- **usePanelPolling.**
  - `typeId` appears at L4, 7, 10, 15, 25 and 63. The test file has it at L42, 100-117.
  - `typeId` appears in no other file under `hooks/`, so the task 3.1 grep can reach empty.
  - The sole non-test caller is `PanelCardBody.tsx:155`, which passes `outputId`.
- **Dead code.**
  - Every non-test `metricOptions` hit is inside `CollectionRenderer.tsx` (L11, 32, 39-40, 51, 71).
  - The only test hits are `CollectionRenderer.test.tsx:34-39` and `MetricRenderer.duration.test.tsx:103`. The adjacent test at L112-122 already pins a `fieldMapping.unit` column being hidden for duration, so Decision 5's "delete" branch applies.
  - `panel-detail-modal__segmented` appears only in `sections.css` (L5-38), `mobile.css` (L198-202) and the CSS lock test (L193-202). The e2e hit is an unrelated comment.
- **CLAUDE.md:155** reads as quoted. The plan correctly gates the edit on a live probe and escalates under C4.
- **write-path-audit.**
  - The scenario at L25 is stale as claimed.
  - `panelService.ts:89` posts `/api/panels/updateBatch`.
  - `PanelDetailModal.tsx:135` calls `accumulatePanelUpdate`.
  - `OutputPicker.tsx:134` dispatches `swapPanelOutput`.

### Verdict: CONFIRM

The artifacts are concrete, internally consistent and cover all five ACs. Each claim I spot-checked against the tree holds. The archive mechanism is proven end-to-end on the current delta.

### Non-blocking notes

- Decision 5's MetricRenderer branch is already decidable: L112-122 pins the bound-unit case. Delete the `metricOptions` variant and record that in evidence.md.
- AC1 says "via an OpenSpec MODIFIED delta ... only". The canonical-spec retitles and the Purpose edit are direct edits forced by openspec's limits (they are documented in Decision 1). State this plainly in the PR body so a reviewer does not read it as scope drift.
- Carry-over notes still apply:
  - list the `.../panels/:panelId/rows` CLAUDE.md line and the unlisted panel config PATCH writes (`panelService.ts` L98-223) as follow-ups;
  - do not describe `usePanelPolling` as live behaviour.
