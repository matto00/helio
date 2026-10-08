## Context

See proposal.md (Why). Current state, verified on main 55b7c4269:
- `OutputService.validateConfig` (OutputService.scala ~L476) = fieldMapping slots + `OutputCompare` + `PayloadOptIn`.
  Called by `create` (L133), `update` on the MERGED config (L244) and `PatchSetPreviewProjection` (L135-136).
  Patch-set apply/rollback go through `update` (PatchSetApplyForward L104, PatchSetApplyRollback L181 — rollback
  re-sends the full prior config as the patch).
- `PipelineService.validateOutputFieldMapping` (~L674) is a second, stricter validator for single-call create and
  proposal grounding (L1506); it never calls `validateConfig`.
- Readers never decode config into a case class (`JsObject.fields.get` everywhere; frontend `read*Config` pick known
  keys), so unknown keys are harmless on read. Stored legacy keys exist (V94 migration: `metricLabel`, `metricUnit`,
  `columnWidths`, `tableDensity`, `chartAnnotation`, `collectionOptions`, `timelineOptions`; plus HEL-877's dead
  deep-merge keys `legend`/`tooltip`/`seriesColors`/`axisLabels`, read by nothing).
- HEL-1351 applies a well-formed chart aggregation on the dashboard (`ChartOutputPanel.tsx` L81-96 via
  `chartAggregationSpec`, chartOverlay.ts L42) and the server reducer mirrors it (OutputSummaryReducer L108-122).

## Goals / Non-Goals

Goals: reject unknown/typo'd keys and malformed/inapplicable `aggregation`/`chartType` at write time on every write
path, with actionable messages; never break reads or updates of Outputs carrying stored legacy keys.
Non-goals: see proposal.md Non-goals. No migration, no frontend read-path changes beyond the editor scatter fix.

## Decisions

**D1 — 400, not a warning.** The ticket allows either. A warning needs a new response field every caller (MCP,
helio-news `build.py`) must learn to read; the reported failure mode is precisely callers not noticing. 400 is the
existing contract shape for `compare`/`historyPayloads`/fieldMapping errors. AC3 is met by D3, not by downgrading to
a warning.

**D2 — One pure validator, `OutputConfigValidation` (new file in `services/pipelines`).** Holds the per-kind known-key
table (as a `Map[OutputKind, Set[String]]` built from a shared cross-kind set — `fieldMapping`, `compare`,
`historyPayloads` — plus per-kind sets exactly as in the spec), the aggregation/chartType checks, and the hint
builder. API: `validate(kind, written: JsObject, stored: JsObject): Either[String, Unit]` where `written` is what the
caller sent (create body or PATCH patch) and `stored` is the pre-write config (`JsObject.empty` on create). Kept out of
`OutputService` so its edits stay small (HEL-1187 splits OutputService next). `OutputService.validateConfig` gains a
`stored` parameter and calls it first; `PipelineService.validateOutputFieldMapping` calls it with `JsObject.empty`.
Alternative (validate merged config only) rejected: merged config contains stored legacy keys → every update of a V94
Output would 400 (breaks AC3).

**D3 — Tolerance rule: "introduce or change" is rejected, "re-send unchanged" is accepted.** For each key in
`written` not in the kind's set: reject unless `stored.fields.get(key) == Some(writtenValue)`. This keeps (a) PATCHes
of unrelated keys, (b) GET→modify→PATCH full-config round trips (common MCP/helio-news pattern), and (c) patch-set
rollback (re-sends full prior config; unknown keys there are unchanged from stored) all working, while still catching
every typo, since a typo is by definition a new key. Same rule for `aggregation`/`chartType` value checks: validated
only when the written value differs from the stored one, so a stored malformed aggregation never blocks an unrelated
write. Messages list ALL offending keys in one 400, sorted.

**D4 — Hints.** For an unknown key: if it is a known legacy rename (`metricLabel`→`label`, `metricUnit`→`unit`,
`chartAnnotation`→`annotation`), suggest that; else if it is known for a different kind, say "`chartType` is not a
table config key"; else nearest known key of this kind by Levenshtein distance ≤ 2 (case-insensitive) as "did you mean
`label`?"; for `legend`/`tooltip`/`seriesColors`/`axisLabels` say chart styling lives on the panel's
`appearance.chart`. Message ends with the kind's sorted known-key list.

**D5 — Aggregation/chartType rules.** Exactly per spec: chart `{groupBy, agg, yField}` (all required); metric `{agg}`
with optional `value` — mirroring every metric reader (OutputSummaryReducer L90-106 `metricField` = `fieldMapping.value`
else `aggregation.value`; `metricHistoryView.ts` `resolveServerMetricField`; MetricOutputPanel L76-78), which all
render `fieldMapping.value` + `{agg}` (pinned by OutputSummaryReducerSpec L66/L92, metricHistoryView.test.ts L12). Only
when the write sets a NON-NULL metric aggregation (changed from stored): the resulting config must resolve a field
(`fieldMapping.value` or `aggregation.value` non-empty), and when both are non-empty they must be equal (otherwise
`aggregation.value` is silently ignored). A metric with no field and no aggregation stays valid (editor save before a
field is picked sends `{fieldMapping:{}, aggregation:null}`; HEL-1326 `metric: null` is a supported state). No extra fields, non-empty
strings, agg ∈ {count,sum,avg,min,max} (same set as `isAggFn` and the reducer's `Aggs`); `null` is OK on chart/metric; on any
other kind `aggregation` is not a known key at all, so even `null` is rejected by the key check (no special case). Scatter check uses the RESULTING chartType
(`written.chartType` if present, else stored, default `line`) and fires only when the write sets `aggregation` or
`chartType`. Rejecting (vs. wiring) is the only option for scatter/other kinds: no renderer can aggregate them, and
the editor already hides aggregation for scatter (OutputKindFields L103-107).

**D6 — Remove the dead deep merge.** `mergeableSubObjects` (OutputService ~L481) goes; `mergeConfig` becomes a plain
shallow merge. Under D3 a stored `legend` can only be re-sent unchanged, for which shallow vs deep merge give the same
result, so no stored data changes. The `output-routes-api` partial-merge requirement and its HEL-877 tests are updated
(delta spec MODIFIED); `OutputProtocol.scala` L13/L92 docs, `outputConfigTypes.ts` comment and helio-mcp
`update_output` text are corrected.

**D7 — Frontend.** `buildOutputConfig` chart branch emits `aggregation: null` when `chartType === "scatter"`
(otherwise the editor would now 400 when switching an aggregated chart to scatter). Every key the editor or
`TableRenderer` writes is in the known set (verified against buildOutputConfig.ts and TableRenderer.tsx L251-278).
`OutputEditorSheet.tsx` L355-356 currently discards the thunk's rejected value (which `outputsSlice` already fills with
the server message via `extractErrorMessage`) and shows a fixed "Failed to save output."; it changes to show the
rejected message (falling back to the fixed text), so the editor names the rejected key.

**D9 — Restoring journaled state bypasses the HEL-1313 checks.** Patch-set rollback (PatchSetApplyRollback L181)
re-sends the full prior config, which may legitimately hold a value the new rules reject (e.g. today's editor-made
scatter chart with an aggregation, fixed forward to `bar`, rolled back to scatter). `OutputService.update` gains an
explicit write-policy argument (a small sealed ADT, e.g. `OutputConfigWritePolicy.{ValidateWrite, RestorePriorStored}`,
mirroring `LayoutWritePolicy.RestorePriorStored`; default `ValidateWrite`, never reachable from a route — the route and
PatchSetApplyForward keep calling the default). Rollback passes `RestorePriorStored`, which skips
`OutputConfigValidation` but keeps the pre-existing fieldMapping/compare/historyPayloads checks exactly as today. A test
proves a normal route PATCH with the same scatter-plus-aggregation value still gets 400.
`PatchSetUndoService` L297 restores via a raw `insertInternal` and deliberately validates nothing — restoring
previously stored data must never be refused; a code comment records this so it is not "fixed" later.

**D11 — In-app assistant contract docs.** Claude writes Output config through three in-app surfaces now validated by
this change: (a) pipeline proposals (`AssistantProposalToolSchemas.PipelineProposalOutputSchema` ~L242-267, config a
bare `{"type":"object"}`, grounded via PipelineService ~L1505); (b) the assistant's `propose_patch_set` tool, whose edit
schema allows `target.kind: "output"` (AssistantProposalToolSchemas ~L364) with an untyped `patch` (~L384-391), sent by
`AssistantToolExecutor.executeProposePatchSet` (~L317-333) through `patchSetPreviewService.preview`; (c) `/api/refinements`
Output edits (`RefinementEditShape.scala` ~L211-216/L260-261, used by `RefinementPrompt.scala` ~L27). All three get the per-kind keys and aggregation shapes from ONE
string built from `OutputConfigValidation`'s key table (e.g. `OutputConfigValidation.KeysDoc`) so prompt and validator
cannot drift. Test: `AssistantProposalToolSchemasSpec` (proposal schema + `propose_patch_set` patch description) and
`RefinementEditShapeSpec` assert every kind's keys and both shapes appear. helio-mcp's equivalent surfaces (add_output,
update_output, create_pipeline, propose_pipeline, and `apply_patch_set`'s output edits, `refinement.ts` ~L78-104) are
covered by task 2.3 with a hand-written TS doc string (separate package; the 400 message's key list is the backstop).

**D10 — Clearing a stored legacy key.** Writing `null` to an unknown key that is currently stored is accepted; the
shallow merge is UNCHANGED, so the key is stored as JSON `null` (exactly as `compare: null` is today) and GET returns
`"metricLabel": null` — never a merge change that drops null keys. `null` to an unknown key that is not stored is
rejected like any other new key.

**D8 — Contract docs.** Request schemas (`create-output-request`, `update-output-request`,
`create-pipeline-transactional-output-request`) declare the union of known keys with `aggregation` (oneOf the two
shapes or null) and `chartType` (enum or null), and describe the per-kind rule; they do NOT set
`additionalProperties:false` on `config`, because D3 legitimately accepts an unchanged stored legacy key that a
schema cannot see. Response schemas stay free-form (`config` may carry legacy keys on read). helio-mcp descriptions
document keys + shapes (new spec requirement), next to `COMPARE_CONFIG_DOC`.

## Risks / Trade-offs

- [MCP/API callers sending never-read keys now get 400] → intended (ticket AC1); helio-mcp docs updated; message lists
  valid keys. (helio-news `build.py` was not inspected; its owner should expect 400s for any dead key it sends.)
- [Rollback restoring a value the new rules reject] → D9 exempts restoration; covered by a forward+rollback test.
- [A PATCH changing only `fieldMapping.value` can leave a stored, now-conflicting `aggregation.value` unchecked] →
  accepted gap (D3/D5 only validate what a write changes); the reducer's precedence (`fieldMapping.value` wins) is
  unchanged, so behaviour matches today.
- [Assistant pipeline proposals / refinement Output edits with a made-up key now fail grounding/preview instead of
  being silently ignored] → intended; D11 documents the keys in all three in-app surfaces; grounding reports a per-Output
  `validationError` the assistant can act on.
- [helio-news `build.py` not inspected] → flagged in the PR body for the owner.
- [Equality of JSON values for D3] → spray-json `JsValue` structural equality; number formatting (`1` vs `1.0`) could
  mis-compare → only affects unknown keys, worst case a 400 the caller fixes by omitting the key.

## Planner Notes

- Self-approved: D1 (400), D3 tolerance, D6 removal of the dead deep merge (no reader exists; verified by grep of
  frontend/src, helio-mcp/src, backend/src/main), chartType enum check (needed for D5's scatter rule).
- Contention: touches `PipelineService.validateOutputFieldMapping` (Output config validator, not pipeline-run guard or
  analyze); concurrent lanes HEL-1374/HEL-1279 are told via the driver report.
