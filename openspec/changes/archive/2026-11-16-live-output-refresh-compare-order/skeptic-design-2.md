## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 0c699d2633e5dedbc14cb3bddaca6147dd6b6025. The planning artifacts are uncommitted in the worktree. Owner
rulings (escalation HEL-1705-1794878026855-00ebb1, sub_answers `saved-to-schema`, `dashboard-parity`, `latest-y`, read
from `.concertino/runs/HEL-1705/events.jsonl` lines 4-5) and Standing Constraints C1-C6 are treated as binding.

### What I verified (with evidence)

Round-1 change requests, re-checked against the current artifacts and the tree:
- CR1 (tables): D7 now routes `columns` into `deriveKeys`/`useTableRows`, keeps the HEL-127 natural sort only as a
  no-`columns` fallback, and adds a table case to 4.8. `useTableRows.ts:66-77` natural-sorts paginated rows today, so the
  fix point is right. Addressed.
- CR2 (saved-path plumbing): D7 and task 3.6 name `fetchPanelPage`, the slice window, `StoredWindow`/`WARM_WINDOW_KEYS`
  (`warmStore.ts:50`), `usePublicPanelData`, `useSavedOutputRows`, the page-merge rule and the no-`columns` fallback.
  Addressed.
- CR3 (metric arithmetic): D4 ports `deltaAndPct` exactly. The port matches `OutputHistoryService.scala:156-163`:
  `c - b` filtered finite, `None` when `b == 0.0`, `(c-b)/|b|*100` filtered finite. A shared fixture is asserted on both
  sides. The null-latest case is specified. Addressed.
- CR4 (rows-line `truncated`): D4, 3.8 and 4.4 cover it. Addressed.
- CR6 (measurement): 4.5 now mounts the hook or layout with `postDraftPreview` mocked, includes a mid-burst switch and a
  mutation. Addressed (see note 3).
- CR7 (spec contradiction): the draft-preview delta now MODIFIES both "streams per-step lines…" and "bounds the request…"
  (headers match `openspec/specs/pipeline-draft-preview-api/spec.md:9,148`). Tasks 2.6 and 2.7 cover the line schema
  description and CLAUDE.md (`CLAUDE.md:174` still says "exactly one final `rows` line"). 3.2 covers the client comment.
  Addressed.
- CR8 (tile shapes): D5 limits the tile to line, area or bar charts with single x/y strings, no aggregation and no
  series. The order comes from `resolveChartPlan`/`planTimeAxis` (`utils/chartTimePlan.ts:51,125`), and the renderer
  confirms it uses that order: a time plan plots `timed`, and the category fallback replaces `rawRows` with
  `plan.ordered` (`chartDataOptions.ts:123-125`). 4.9 checks a record order that differs from the plot order. Addressed.

New design claims I checked against the tree:
- D1: `TopKeys` (`DraftPreviewRequestDecoder.scala:20`) and `QueueCapacity = MaxSteps + 2` (`DraftPreviewService.scala:34`)
  exist. The planner's `walkSteps` excludes only unavailable steps (`DraftPreviewPlanner.scala:57`), with no pruning to
  the rows step's ancestors. So an extra id on another branch is evaluated. Holds.
- D6: Scala is 2.13.15 (`backend/build.sbt:4`), so `VectorMap` exists. `OutputRowsResponse.items: Vector[JsValue]`
  (`OutputProtocol.scala:106`) is written as-is, so a `VectorMap`-backed `JsObject` keeps its order on the wire.
  `OutputRowReads.rows` has `output.schema` in scope. The history-payload service has the Output in scope
  (`OutputHistoryService.scala:63-77`; the `Some(_)` binding needs to be named). Holds.
- D7: `recordsToPanelRows` uses `Object.keys(records[0])`/`Object.values` (`outputRenderInputs.ts:26-36`). It has three
  callers: `usePanelData.ts:322`, `usePublicPanelData.ts:133` and `LiveOutputRender.tsx:37`. `frameToRecords` uses
  `defineProperty`, which still enumerates integer-like keys first. So the `columns` argument is the right seam. Holds.
- D4/E: `selectChartOverlay` hides the overlay whenever `rowsTruncated !== false` (`chartOverlay.ts:95`).
  `ChartOutputPanel.tsx:112-118` applies the `groupedPlot` guard inline. `ChartRenderer` accepts `overlay`
  (`ChartRenderer.tsx:32`). Holds.

Two claims do not hold. See the change requests below.
- D2's memory claim. In `InProcessPipelineEngine.scala:568-575`, `releaseConsumed` drops every frame outside
  `retainOnly` and the remaining dependencies, and calls `tally.remove(o.rows)`. `onNodeFrame` fires before that
  (`:611-612`). The primary rows step is kept by `retainOnly` (`DraftPreviewService.scala:199`), so it stays charged to
  the live-cell tally until the walk ends. A slice captured inside `onFrame` is never charged.
- D3's mobile claim. `PipelineMobileLayout`'s `previewChosenId`/`chosenId` is the Preview tab's step choice: a step id,
  matched by `entries.find((e) => e.step.id === chosenId)` (`MobilePreviewTab.tsx:59-62`). It is not an Output pick. The
  phone mounts its own `LiveOutputColumn` (`MobilePreviewTab.tsx:94-99`), and that column holds its Output pick in local
  `useState` (`LiveOutputColumn.tsx:71`).

### Verdict: REFUTE

### Change Requests

1. **D2's bound on retained memory is false, and the planned HeapSpec shape can pass without testing it.**
   - D2 says extra retained memory is "at most 8 x 1,000 row references, outside the live-cell tally". A row reference
     keeps the whole row alive, with every cell and string in it. For any frame of 1,000 rows or fewer, `take(1000)`
     keeps the entire frame.
   - The live-cell budget (`DraftPreviewLimits.MaxLiveCells` = 1,800,000 cells, text priced by length) can be used up by
     a frame of 1,000 rows or fewer. For example, a `compute` step can write roughly 40k-character texts per row; the
     per-text cap is 262,144 characters.
   - When such a frame is captured for an extra id and then released, `tally.remove` frees its budget. The next branch
     can then create a fresh budget's worth.
   - The worst case is about (1 + extras) x the budget. With the client's 2 ids, that is roughly twice the measured
     74.5 MB peak. With the 8 ids the server accepts from any client, it is roughly nine times. `DRAFT_PREVIEW_MAX_IN_FLIGHT`
     is derived from that measured peak, and the 768 MB heap would not survive two such requests.
   - Revise D2 so the captured slices count against the same budget. Two options:
     - Charge each captured slice to the engine's `LiveCellTally` and keep it charged, through a small engine hook that
       retains a capped head.
     - Widen `retainOnly` for the extra ids.
   - State which option is chosen and its behaviour cost: does a draft that passes today fail with the memory limit once
     an Output is displayed?
   - Make 4.3's shape explicit and adversarial: 8 extra ids, each on its own branch, each a frame of 1,000 rows or fewer
     whose text or cells come close to the budget, built one after another so each is released before the next. A
     shape built from 20,000-row "maximal" frames captures only 5% of each frame and proves nothing.
   - Amend the "A request's live memory is bounded" requirement (`pipeline-draft-preview-api/spec.md:64`) or the new
     requirement so that the captured rows are inside the stated budget. As written, the spec says the held frames stay
     within the budget, and D2 deliberately holds rows outside it.

2. **D3 does not cover the phone's Output pick.**
   - D3 says `PipelineMobileLayout` "already holds `chosenId` for the draft transport". That is the Preview tab's chosen
     step, not the explicit Output pick.
   - Once the column becomes controlled, one of two things happens. The phone's `LiveOutputColumn` mount does not
     compile, or, if `pick` stays optional or uncontrolled, an explicit Output pick on the phone never reaches the
     request and still shows "Select this step to update it". The ticket's AC requires checking on the phone.
   - Specify the following:
     - (a) `PipelineMobileLayout` holds the Output `pick`, alongside `previewChosenId`, and passes `pick`/`onPick` through
       `MobilePreviewTab` to the column.
     - (b) Which step id the mobile layout passes to `resolveDisplayedOutput`. It should be the Preview tab's resolved
       step: `previewChosenId`, falling back to `defaultPreviewStepId`, then the first entry, the same fallback chain as
       `MobilePreviewTab.tsx:59-62`. It should not be `focusStepId`, which is the open step while the Steps tab shows.
     - (c) A phone case in 4.4 or 4.5: an explicit pick of a non-focus, server-resolved Output gets its rows without a
       new request per edit.

### Non-blocking notes
- D6 `columns` lists schema names "always", even names absent from every row. A saved chart with no x mapping then takes
  `headers[0]` as a missing column, while the live view (`orderLiveColumns` keeps only schema names present in the
  frame) takes the first present column. They diverge when the schema and the stored rows drift apart. Consider listing
  only present schema names on a non-empty page, or have the client drop the absent ones for headers.
- `inspectColumnKeys` (`inspectColumnOrder.ts:22-42`) already puts the schema first but natural-sorts extras. D7 says
  "one ordering rule everywhere" and that `PanelInspectView` "receives the same `columns`". State whether Inspect then
  uses `columns` outright (the HEL-1394 natural-extras tests change) or keeps its own function.
- 4.5: state the expected count for the mid-burst Output switch. If it is "at most one more than the no-Output burst",
  say so, so the assertion is not invented at execution time.
- D1: an extra id naming an unavailable step (an AI step or one downstream of it) presumably gets an `available: false`
  rows line, like the primary. Say so in the spec scenario list.
- D5: "the last plotted point" when that row's y is non-numeric. Say whether the tile skips back to the last numeric y
  or shows blank.
