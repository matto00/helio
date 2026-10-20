## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: c1add2394b2d89d6a3779c170a64eb254fc4b734 (artifacts untracked in the change dir).

### What I verified (with evidence)
- CR1 (column order): design.md D2 now states that the saved order comes from JSONB plus spray `JsObject` and cannot be reproduced. The live path orders columns by `output.schema` through `orderLiveColumns`. The order-dependent cases are listed (no xAxis `headers[0]`, the pie/first-numeric fallback, and table order with no `columns` config). D8 adds a parity case with no xAxis mapping whose records arrive in a different key order, asserting schema order. The spec "Not-previewed" requirement and the reversible-calls list carry it. Addressed.
- CR2 (D3 rows): the table now has (a) view `ok` with `rows === null` and not `frameStale` → saved rows + "stale" + hint, never live; (b) no usable sample (error, image source, no entry for this viewer) → saved rows + "Showing the last run."; (c) root-bound Output → root sample frame, never "live". Tasks 2.3 require tests for every row. The spec has a "No usable sample" scenario. Addressed.
- CR3 (latency): D6 "Latency", D8, tasks 5.2 and standing constraint C7 now gate the 10-edit burst in `hel1632-live-output.spec.ts` with a chart Output displayed (edit 1 < 100 ms, edits 2-10 < 50 ms). They also add a coalescing fallback and forbid relaxing the budget. Input-to-column timing is reported only. Addressed.
- CR4 (history): D4 uses `fetchOutputHistory(outputId)` with the default limit under `outputHistoryKey`. I confirmed this against the live tree: `useOutputHistory.ts:38-46` calls `fetchOutputHistory(outputId)` keyed by `outputHistoryKey(outputId)`, so the cache entry is shared and not poisoned. Addressed.
- Round-1 notes: D6 now renders with `defaultPanelAppearance`, so the chart type is the Output's own and the panel override is listed. D7 re-runs the 1280×800 no-scroll and readability checks with the context list at 248 and 400px. Both addressed.
- New-defect sweep: proposal, design, tasks and both spec deltas are consistent. I found no placeholders. Every AC is covered: parity by D1/D8, zero requests per edit by C3 and the e2e, caption/pill/not-previewed by D3 and the component tests. The scope stays inside the run brief (frontend only, HEL-1684/1685 excluded).

### Verdict: CONFIRM

### Non-blocking notes
- D3 "no sample entry for this viewer" needs a positive eligibility rule, not "the entry is absent". `useSourceSamples.ts:27-44` dispatches only after the sources list loads (owned ids) or once analyze sets `canSampleShared`. Before that, "absent" also means "not yet requested". If `liveOutputSource` treats absence as "no sample", an editor grantee would fetch `/rows` and flash saved data before its shared sample arrives. Treat absence as "loading" until sources status has settled and analyze has answered. Only then treat an id that is neither owned nor shared as "no sample", and cover both cases in the `liveOutputSource` tests.
- The D3 rows are not explicitly ordered. Make the precedence explicit in `liveOutputSource`: "no usable sample" before "root-bound", and "notPreviewed" before draft-view status. For example, a root-bound Output with a failed sample should resolve to saved rows, not to an empty root frame.
