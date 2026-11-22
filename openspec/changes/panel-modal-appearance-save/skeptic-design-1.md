## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 68829c1c677f31c38dd695cfb06ecff0690a6a7e (change dir untracked). Artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/panel-detail-modal/spec.md.

### What I verified (with evidence)

- **Server merges, so the "precedent" in the ticket is stale (confirmed).** `PanelMutationRepository.scala:110-116` runs
  `PanelAppearance.applyPatchJson(appearanceJson, current)` for each batch item. `PanelAppearance.scala:76-85`
  (`applyPatch`) folds every absent key to `existing.*`, and an absent `chart` keeps `existing.chart`.
  `PanelServiceHelpers.scala:38` uses the same merge on the single PATCH.
- **What the modal sends (confirmed).** `PanelDetailModal.tsx:147-159` always sends `{background, color, transparency}`
  (all three, edited or not) plus `title` only when it changed. It never sends `chart`.
- **Client replaces the local appearance (confirmed).** `panelsSlice.ts:131-133`:
  `{ ...panel, ...fields }` replaces `panel.appearance` wholesale, so the local `chart` is dropped.
  `buildBatchRequest` (`panelsSlice.ts:528-549`) forwards the partial appearance as-is.
- **Render depends on the local chart (confirmed).** `resolvePanelChartType.ts` uses `chart?.chartType` and otherwise
  the Output's `config.chartType`, else `line`.
- **Design claim checked and found inaccurate: the loss lasts until a refetch.** `panelsSlice.ts:338-341`
  (`updatePanelsBatch.fulfilled`) replaces each item with the server's response panel. Because the server merges,
  the local chart comes back at the next flush (30 s auto-save, Save now, unmount flush), not only at a refetch. The
  client loss exists only between the accumulate and the flush. This affects how the probe must be run (CR2).
- **A case the plan misses: transparency precision.** `usePanelDetailEditState.ts:35` initialises
  `Math.round(clampTransparency(panel.appearance.transparency) * 100)`, and the modal sends back
  `transparency / 100`. The server stores an arbitrary `Double` (`PanelAppearance.scala:7`, 52-56). A stored 0.555
  (which the API or MCP can set) becomes 0.56 on a title-only save. The new spec says the save "SHALL NOT change any
  appearance field the user did not edit ... an untouched ... transparency SHALL be preserved". Design Decision 2
  (merge in the reducer only) does not deliver that, and neither the design nor the tasks mention it.
- **Coverage.** AC1 maps to task 1.1/1.2. AC2 maps to 2.1, 3.x and 4.x. AC3 maps to 1.3 plus the guard. No API or
  schema change, so no contract delta is needed. The non-goals are appropriate.

### Verdict: REFUTE

### Change Requests

1. **Fix the contradiction between the spec and the design on unedited transparency (and on colour/background in
   general).** The modal always re-sends all three scalar fields, so "preserved" holds only when the value round-trips
   through the modal's state unchanged. Transparency does not (whole-percent rounding,
   `usePanelDetailEditState.ts:35` and `PanelDetailModal.tsx:150`). Choose one option and record it in design.md:
   (a) the modal's appearance patch carries only the fields the user changed. This also matches Decision 2's own
   lost-update rationale against concurrent API/MCP edits, which applies to background/color/transparency just as it
   does to chart. Add a task and a jest case for a title-only save over a non-whole-percent transparency.
   (b) Narrow the spec requirement to say explicitly that transparency is preserved to the modal's 1 % precision, and
   justify it.
   Either way, the probe in task 1.1/1.2 must use a stored transparency that is not a whole percent, so the probe
   measures this case instead of assuming it.
2. **Correct the claim about how long the client loss lasts, and make the probe read client state before the batch
   flush.** Design Context says the dropped local chart persists "until refetch" and Decision 1(b) says "before any
   reload". In fact `updatePanelsBatch.fulfilled` (`panelsSlice.ts:338-341`) restores the server copy at the next
   flush. A probe that clicks Save now, or waits more than 30 s, sees a healed state and would wrongly record "nothing
   lost". Task 1.2 and the 4.1/4.2 guards must read the Redux panel and the rendered chart type after the modal save
   and BEFORE any flush. Each must also record whether the flush heals it, and how long the wrong render was visible.
   Update the spec scenario "Client state keeps the chart appearance after save" to say "before the pending batch is
   flushed".

### Non-blocking notes

- The rendered-chart-type check proves nothing if the probe's stored `appearance.chart.chartType` equals the bound
  Output's `config.chartType`, or is `line` (the fallback). The resolver would draw the same chart either way. Pick a
  stored chart type that differs from both. The mutation check in 4.3 should catch this, but say it explicitly.
- `updatePanelOutputControls.fulfilled` (and the other typed-thunk fulfils) replaces the item with the server copy
  while the modal's title/appearance is still pending, so the title briefly reverts in client state until the flush.
  This existed before this change and is outside its scope. If the probe sees it, record it as a spinoff rather than
  widening this change.
- The comment at `PanelDetailModal.tsx:163` says output-kind panels have no subtype editor, but they do
  (`OutputControlsEditor`/`controlsEditorRef`). Task 1.2 should cover that save for output panels.
