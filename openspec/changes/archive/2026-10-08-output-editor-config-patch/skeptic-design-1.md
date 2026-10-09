## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7` (the change dir is still untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md.

### What I verified (with evidence)

- **Server merge semantics (D1/D6 premise): confirmed.** `OutputConfigValidation.scala:199` `mergeConfig = JsObject(existing.fields ++ patch.fields)`. That means an omitted key is kept, a present key replaces the whole value (so `fieldMapping` is replaced whole), and `null` is stored as `JsNull`. `OutputService.scala:198-203` merges, then validates `(patch, existingConfig)`.
- **Null tolerance: confirmed.** `label`, `unit`, `columnOrder` and `annotation` are all in `KnownKeys` for their kinds (lines 22-27), so a `null` for them always passes the key check. `validateChartType` and `validateAggregation` accept `JsNull`. `tolerated` (line 66) also accepts `null` for a stored unknown key.
- **Symptom 1 (layout/sort): confirmed.** `buildOutputConfig.ts:129` hard-codes `layout: "grid"` and `:133` hard-codes `sort: "asc"`. `OutputEditorSheet.tsx:353` sends the full build on edit.
- **Symptom 3 (annotation): confirmed.** `OutputEditorSheet.tsx:214` seeds `chartFieldMapping` from the stored `fieldMapping`, annotation key included. `buildOutputConfig.ts:69-74` spreads it and adds `annotation` back only in field mode, so the stored key survives a removal.
- **Symptom 2, table `columnOrder`: confirmed.** `useOutputTableColumns.ts:105` returns `undefined` when the visible keys are in natural order. JSON drops it and the stored array survives.
- **Symptom 2, metric `label`/`unit`: the stated root cause is wrong.** See CR3.
- **Readers already treat null as absent: confirmed.** `outputConfigTypes.ts:256` (columnOrder must be an array), `:265-266` (label/unit must be strings). `readChartConfig` uses `annotation ?? null`.
- **Read-default normalization (D1's case against diffing raw stored config): confirmed.**
  - `readCollectionConfig`/`readTimelineConfig` default `layout`/`sort`.
  - `metricFormat` is seeded as `?? "number"` (`OutputEditorSheet.tsx:254`).
  - So diffing against an open-time *built* baseline is the right general shape.
- **Mounting: OK for the baseline.** `PipelineDetailPage.tsx:333` mounts the sheet conditionally (`{outputSheet && ...}`), so the per-kind `useState` seeds come from the opened Output. An open-time baseline is well defined.
- **Async capabilities for table `columnOrder`: sound as designed.** Before capabilities load, `fieldKeys = []` and the hook yields its natural value. A baseline derived through the same `buildOutputColumns` on the same `fieldKeys` therefore matches on both sides, before and after load. The baseline has to be recomputed from the current `fieldKeys`, not frozen at open time; D1/D3 do say this.
- **HEL-1394: not implemented.** Linear shows HEL-1394 in **Backlog** ("needs owner ruling").
  - Both Inspect grids take columns from `Object.keys(rows[0])` (`usePanelData.ts:215`, `usePublicPanelData.ts:133`).
  - `PanelInspectView.tsx` has no `columnOrder` reference.
  - `TableRenderer.tsx:334-346` falls back to row-key order (`headers`), not schema order, when `columnOrder` is absent. It uses the declared schema only for zero-row pagination.
  - Result: clearing to `null` cannot regress an Inspect order that does not read `columnOrder` today. It does make a spec claim false (CR2).
- **Tests demanded:** frontend tests that check the payload and fail first (1.1), a backend pin of the merge semantics (3.1), and a live DB before/after check (3.2). The coverage gaps are in CR3, CR5 and CR6.

### Verdict: REFUTE

The overall shape (diff against an open-time baseline, explicit `null` for clears, the annotation base change) is sound. Four places in the artifacts are factually wrong or under-specified enough to cause a wrong implementation or a test that proves nothing, and the task list has two coverage gaps.

### Change Requests

1. **Table: the design treats "natural order" as "all columns visible". The hook does not.** In `useOutputTableColumns.ts:93-96`, `natural = fieldKeys.filter(k => visible.includes(k))`. That always has the same length as `visible`, so `columnOrder` is `undefined` for *any visible subset kept in natural relative order*, hidden columns included. `TableRenderer.orderedColumns` (`TableRenderer.tsx:171-176`) treats `columnOrder` as the visible set, so hidden columns exist only through it.
   - D3 tells the implementer to map the hook's "natural order" to `null` on edit. Implemented literally, that sends `null` and **un-hides columns**.
   - Example: stored `["b","a"]` over fields `a,b,c` (c hidden). The user moves `a` above `b`. The planned code sends `columnOrder: null` and the dashboard table shows `c` again, while the editor showed it hidden.
   - **Required:** restate D3 so `null` is emitted only when *every* field key is visible and in natural order. A hidden subset in natural order must emit the visible array.
   - Say whether create mode changes too. It should: today, hiding a column without reordering is never persisted.
   - Add a test to 1.1 for the example above that fails before the fix.
2. **The spec scenario "Table column order can be reset" promises an outcome that cannot happen in this tree.** Its THEN clause says "the table (and the Inspect grid) falls back to the Output schema order". Design Risks repeats it ("Inspect grid falls back to schema order (HEL-1394 ruling) — covered by a test").
   - HEL-1394 is Backlog and unimplemented.
   - With `columnOrder` absent, the Inspect grid and the table both render row-key order, which is alphabetical per HEL-1394's own description (`usePanelData.ts:215`, `TableRenderer.tsx:344`).
   - No task in tasks.md adds the claimed test.
   - **Required:** reword the THEN clause to something this ticket can make true and verify. For example: "renders identically to an Output with no stored `columnOrder`". Record that schema-order fallback depends on HEL-1394.
   - Then either drop the "covered by a test" claim from Risks or add a real task for it.
3. **Metric `label`/`unit`: the root cause in proposal.md and design.md is wrong, and the planned test does not cover the user-visible defect.**
   - Proposal says "an emptied metric `label`/`unit` ... is sent as 'omitted'". In fact an emptied literal is sent as `""` (`buildOutputConfig.ts:112-119`: `mode === "literal" ? literalValue : undefined`, and `BoundOrLiteralField` passes `e.target.value` through unchanged). `""` already renders no label: `MetricOutputPanel.tsx:111` (`cfg.label ?? ""`) feeds `MetricRenderer.tsx:128` (`data?.label && ...`).
   - The path where a clear is actually lost is **switching Label/Unit from literal to field mode**. Then `label: undefined` is omitted from the JSON and the stored literal survives and keeps rendering.
   - Task 1.1's "emptied metric literal `label`/`unit` sends `null`" fails today only because `""` differs from `null`. That proves nothing about the user-visible bug.
   - **Required:** correct the narrative in proposal and design. Add tests to 1.1 that fail today for literal-to-field on both `label` and `unit`: the payload sends `label: null`/`unit: null`, and the stored literal is gone afterwards. The `""`-to-`null` change can stay as a secondary consistency fix.
4. **D1's normalized baseline makes existing stale state impossible to remove, which is the exact state the bug produces.**
   - Take a chart stored with both a literal `annotation` and a stale `fieldMapping.annotation`; today's code writes this when the user switches field to literal. It opens in literal mode (`OutputEditorSheet.tsx:222-224`).
   - Under D4 the baseline's `fieldMapping` omits `annotation`, and so does every reachable built state once the user ends in literal mode. `built.fieldMapping` therefore always equals `baseline.fieldMapping`, it is never sent, and the stale key can never be removed through the editor.
   - The same applies to a metric stored with a literal `label` plus a stale `fieldMapping.label`; today's code writes this when the user switches literal to field.
   - Ticket bullet 3 says the stale key "survives saves". For every Output already damaged by this bug, it still will.
   - **Required:** make an explicit decision in design.md, with a test. Either:
     - (a) compare the chart/metric `fieldMapping` key against the raw stored `fieldMapping` (with the stale slot stripped), so a save repairs damaged rows. State that this is a deliberate exception to "untouched keys byte-for-byte" for a key the editor owns; or
     - (b) declare repair of already-damaged rows out of scope and file a follow-up.
   - Silently leaving it to the implementer is not acceptable.
5. **Live DB evidence in 3.2 does not match D6(c).** D6(c) promises a live DB row before and after a real save for "at least one symptom per bullet". Task 3.2 covers only the collection `layout` (bullet 1) and the metric label clear (bullet 2). **Required:** add the chart annotation removal (bullet 3) to 3.2. Also add the table `columnOrder` reset, since that clear is a separate code path from the label clear.
6. **Task 1.1 omits the capabilities-timing test that Risks depends on.** Risks says the mitigation is "test 'open + save untouched sends no config keys' for every kind, including table before/after capabilities load". Task 1.1 lists the untouched save per kind but not the before/after-capabilities-load cases. **Required:** add both table timings to 1.1. The "before" case means Save is clicked while the capabilities fetch is still pending, with a stored `columnOrder` present. Assert no `columnOrder` key in either case.

### Non-blocking notes

- D1's comparison rule ("treating `undefined` and `null` as equal ... only when both sides are 'empty'") is circular, because both values are empty by definition. Write it as "`undefined` and `null` compare equal; otherwise deep-equal".
- Markdown: `buildOutputConfig.ts:125` always emits `fieldMapping: {}`. Under D1 a stored legacy `fieldMapping.content` is no longer dropped on save, which contradicts the comment at `OutputEditorSheet.tsx:258-259`. That is consistent with the AC; update the comment.
- Task 3.1's backend test pins existing behavior and cannot fail first. Label it a guard, and confirm it fails under a mutation, e.g. `mergeConfig` dropping `JsNull` keys.
- When the diff is empty, decide whether to send `config: {}` or omit `config`. Both are safe on the server (`OutputService.scala:198-203`). Pick one and assert it in the untouched-save tests.
