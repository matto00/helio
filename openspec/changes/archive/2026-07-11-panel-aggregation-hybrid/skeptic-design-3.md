## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

1. **Read ticket.md, proposal.md, design.md, tasks.md, and all three spec deltas in full** (fresh, not
   assuming round-1/round-2 reports are accurate). Confirmed Decision 4 in design.md and tasks 5.1-5.5 /
   7.1-7.3 were materially rewritten from round 2 (relocating chart aggregation computation from
   `ChartPanel` into `usePanelData.ts`, over typed `rows` rather than `rawRows`).

2. **Confirmed the round-2 count-vs-null gap is actually closed by the rewritten design.**
   - Read `frontend/src/features/panels/hooks/usePanelData.ts` in full. Line 74:
     `const rows = useMemo(() => paginationEntry?.rows ?? [], [paginationEntry]);` — this is the
     `Record<string, unknown>[]` typed row array (Redux `paginationState[panelId].rows`), and is a
     **distinct value** from `rawRows`, which is a *separate* memo (lines 84-92) that stringifies `rows`
     via `Object.values(row).map(v => v != null ? String(v) : "")` — i.e. `rows` still carries real JS
     `null`/`undefined`/typed values; `rawRows` is a downstream, lossy derivative. This confirms Decision
     4's central premise (a data source distinct from `rawRows`, preserving nullness, is actually
     available to `usePanelData`) is real, not aspirational.
   - Traced `paginationEntry.rows`'s provenance: `panelsSlice.ts` (`fetchPanelPage.fulfilled` reducer,
     ~line 184) stores the payload from the `fetchPanelPage` thunk (`panelThunks.ts:237-256`), which calls
     `fetchDataTypeRows(dataTypeId)` (`dataTypeService.ts:57-59`, a plain `httpClient.get` — axios
     JSON-parses the response, so a JSON `null` in the wire payload becomes a real JS `null`, not a
     stringified sentinel) and slices client-side. This is the same full-fetch path design.md's Decision
     1 describes; nothing in this change alters it, and it was already the metric path's data source
     (Decision 3), so reusing it for the chart path is consistent, not a new risk.
   - Cross-checked `AggregateStep.scala:93` (`count` = `groupRows.count(r => r.getOrElse(field, null) !=
     null)`) and `PipelineRowJson.scala:59` (`s.toDoubleOption`, rejects `""`) once more — the TS
     semantics design.md claims to mirror are accurately described.
   - **Conclusion: routing `groupAndAggregate` over `usePanelData`'s typed `rows` (not `ChartPanel`'s
     `rawRows`) genuinely closes the round-2 finding.** `count` can now distinguish a real-null `yField`
     from a real-empty-string `yField`, because the stringification that destroyed this distinction no
     longer sits between the row data and the aggregation computation.

3. **Checked for a new gap introduced by relocating the computation into the hook.** Read
   `ChartPanel.tsx`, `ChartRenderer.tsx`, `PanelContent.tsx`, `PanelCard.tsx`, and `PanelDetailModal.tsx`
   in full to trace the actual prop-threading path chartAggregate must traverse. Found:
   - `usePanelData` is called from exactly two places: `PanelCard.tsx:54` and `PanelDetailModal.tsx:83`.
     Both manually destructure the hook's return value and manually forward each field (`data`, `rawRows`,
     `headers`, `isLoading`, `error`, `noData`) as explicit props into `<PanelContent>` (`PanelCard.tsx:
     81-94`; `PanelDetailModal.tsx:311-315`).
   - Task 5.4 reads: "Thread `chartAggregate` from `usePanelData` through `PanelContent`/`ChartRenderer`
     into `ChartPanel` as a new optional prop" — this names the hook and the two intermediate renderer
     components but does not name `PanelCard.tsx` or `PanelDetailModal.tsx`, which are the two files that
     actually own the call to `usePanelData()` and would need a one-line addition each
     (`chartAggregate` added to the destructure and to the `<PanelContent>` prop list) for the new field
     to ever leave the hook. Grepped tasks.md and design.md for "PanelCard"/"PanelDetailModal" — neither
     file is mentioned anywhere in either document.
   - Checked whether this gap would be caught by the tests tasks.md specifies: task 7.2
     (`usePanelData.test.ts`) and 7.3 (`ChartPanel.test.tsx`) both test their respective units in
     isolation (the latter passing `chartAggregate` directly as a prop) — neither exercises the actual
     `PanelCard`/`PanelDetailModal` → `PanelContent` → `ChartRenderer` → `ChartPanel` call chain, so an
     implementation that computes `chartAggregate` correctly and renders it correctly in `ChartPanel`, but
     forgets to forward it in `PanelCard.tsx`/`PanelDetailModal.tsx`, would pass every test task 7
     specifies. Per Decision 4/task 5.5, a missing `chartAggregate` silently falls back to the pre-existing
     `rawRows` per-row path — i.e. the chart just renders as it did before this change, with no error and
     no failing assertion in the scoped test suite.
   - Severity assessment: this is a real task-specification gap, but a comparatively low-severity one.
     Unlike the round-1/round-2 findings (which were subtle-enough-to-survive-automated-tests semantic
     bugs — wrong numbers computed silently), this gap produces an *obviously inert* feature (chart looks
     unchanged) that a developer implementing and manually verifying "does my grouped chart aggregation
     actually render grouped bars?" would almost certainly notice immediately in their own dev loop, and
     which the final-gate skeptic's UI screenshot pass would certainly catch if it slipped through. I am
     treating this as a non-blocking note rather than a REFUTE-worthy defect (see below), but flagging it
     explicitly per the ambiguity check since tasks.md is otherwise unusually precise about naming exact
     files/line-anchors elsewhere (e.g. tasks 1.1/1.2/5.1-5.3) and this is a real deviation from that
     rigor.

4. **Fresh full pass over proposal.md, design.md, tasks.md, and all three spec deltas for anything else.**
   - `proposal.md`'s Impact section lists `panelSlots.ts` as an affected file; tasks.md never mentions it.
     Checked `panelSlots.ts` and its only consumer (`BindingEditor.tsx:9,104`, `PANEL_SLOTS[panel.type]`)
     — it drives the pre-existing field-mapping slot list (value/label/unit, xAxis/yAxis/series), a
     different UI concept from the new aggregation controls (task 6.1's field/agg-function/group-by/
     value-field selectors, per `specs/panel-datatype-binding/spec.md`). No change to `panelSlots.ts` is
     actually required; proposal.md's Impact list is just a slightly loose preliminary estimate, not a
     contradiction with tasks.md. Not a blocking issue.
   - Confirmed backend/contract/MCP wiring (task 1-3) targets exist and match Decision 5's description:
     `MetricPanel.scala`/`ChartPanel.scala` are `jsonFormat2` today (verified), `ProposalPanel`'s custom
     reader/writer exists with the tolerant-absent-field pattern described, `panel.schema.json`'s configs
     use `additionalProperties: false` (confirming the schema-add task is real and necessary).
   - Confirmed `buildBindingPatch`/`updatePanelBinding`/`panelService.ts` (task 6.2 targets) exist and
     match their described shape/call sites.
   - Spec deltas (`panel-viz-aggregation`, `echarts-chart-panel`, `panel-datatype-binding`) are internally
     consistent with proposal.md's New/Modified Capabilities list and with tasks.md; every ticket AC
     (metric avg + chart avg-by-year with one pipeline; backwards compatibility) traces to a spec
     requirement and a task. No orphaned AC, no contradiction between proposal/design/tasks found.
   - No placeholders/TODOs/deferred decisions found in any of the three artifacts.

### Verdict: CONFIRM

### Non-blocking notes

1. **Task 5.4 should explicitly name `PanelCard.tsx` (`PanelCardBody`, ~line 54/81-94) and
   `PanelDetailModal.tsx` (~line 83/311-315)** as files requiring a one-line addition each (destructure
   `chartAggregate` from `usePanelData()`'s return and forward it to `<PanelContent>`), since these are
   the actual two call-sites of the hook and are not reachable by only touching `PanelContent`/
   `ChartRenderer`/`ChartPanel` as literally listed. Recommend also adding a task alongside 7.3 for an
   integration-level assertion (e.g. in `PanelCard.test.tsx` or `PanelContent.test.tsx`, if either exists)
   that `chartAggregate` returned by a mocked `usePanelData` actually reaches the rendered `ChartPanel`
   prop through the real component tree, not just through directly-constructed unit props — this is the
   one place in the current test task list where the full wiring, rather than each layer in isolation, is
   never exercised.
2. Round 2's minor note about `"Infinity"`/`"NaN"`/hex-literal edge cases in the numeric-coercion parity
   claim still applies and remains non-blocking (unchanged by this round's revisions).
