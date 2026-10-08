## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `92a2d1e7079ed1a1a06de9d0bd2fd08d81a3e461`. The base `55b7c4269d90eea7f3c71f3a2e3857a4018ee47b` was resolved live with `resolve-review-base.sh` (exit 0). The cwd guard returned `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.

### What I verified (with evidence)

**Diff ground truth.** I read the following files in full or as diffs:
- `OutputConfigValidation.scala` (new)
- the diffs to `OutputService`, `PipelineService`, `PatchSetApplyRollback`, `PatchSetPreviewProjection`, `PatchSetUndoService` and `RefinementEditShape`
- the frontend editor diffs
- the helio-mcp diffs
- the schema diffs

The code matches design D2-D11:
- D3 tolerance is `tolerated()`: a key is accepted when it is already stored with the same value, or when the write is `null`.
- D6 replaces the deep merge with a plain shallow merge.
- D9 adds the `OutputConfigWritePolicy.RestorePriorStored` policy. Only `PatchSetApplyRollback` passes it, and no route does.

**AC1: an unknown key returns 400 naming it, for every kind.**
- Live, against this worktree's backend on port 9652:
  - `chartTyp` on a chart → 400 "`chartTyp` (did you mean `chartType`?)" plus the list of valid keys.
  - `legend` → 400 with the hint that chart styling lives on the panel's appearance.chart.
  - `metricLabel` on a new metric → 400 "renamed: use `label`".
  - `aggregation: null` on a table → 400 "not a table config key".
- `OutputConfigKeyValidationSpec` covers a typo for each of the 6 kinds, on both POST and PATCH. It also covers patch-set preview, single-call create (no pipeline is persisted) and proposal grounding (`validationError`).

**AC2: a malformed aggregation is rejected, and a well-formed one still groups.**
- Rejected live:
  - a chart with a metric-shaped `{value, agg}` → 400
  - `agg: "median"` → 400
  - a PATCH to `chartType: scatter` on a chart that has an aggregation → 400 naming scatter
  - a metric `{agg}` with no field → 400
- Accepted live:
  - a well-formed `{groupBy, agg, yField}` bar → 201
  - a metric `{agg}` with `fieldMapping.value` → 201
- Grouped rendering comes from HEL-1351 and this change does not touch it. The evaluator's screenshot `/home/matt/Development/helio/.concertino/runs/HEL-1313/evidence/e2e-evidence/HEL-1313/eval-c1-agg-bar-1440.png` shows the bars grouped east/north/west (sum).
- Both paths are tested in `OutputConfigKeyValidationSpec`.

**AC3: legacy keys.**
- In `OutputConfigKeyValidationSpec`, a raw-seeded metric Output with V94 `metricLabel` and `metricUnit` passes all of these:
  - GET returns `metricLabel`
  - a PATCH of an unrelated key (`compare`) succeeds
  - a full GET→modify→PATCH round trip returns 200
  - changing `metricLabel` → 400 "use `label`"
  - `metricLabel: null` → 200, and the value is stored as null
- Patch-set rollback: the new `PatchSetApplyServiceSpec` case restores a scatter chart that carries both an aggregation and a legacy `metricLabel`, byte-for-byte, after a forward edit plus a failing second edit.
- The dead `legend` and `tooltip` keys follow the same rule. Because the tolerance check only looks at keys present in `written`, a stored `legend` is never judged unless it is re-sent changed.
- Live: a GET→PATCH round trip of a full config returned 200.

**Live writers (point b).**
- `buildOutputConfig`: every kind emits only known keys. I checked each case in the file. Table `columnOrder: undefined` is dropped by JSON serialization.
- `buildAggregateTailConfigs`: emits only known keys and always `aggregation: null`.
- `TableRenderer`: writes only `columnSort`, `columnFilters` and `pinnedColumns`, and only for table-kind Outputs. `HistoryRows` passes no `ownerId`, so `canWrite` is false there.
- `FirstRunPlanner` and `PersonaTemplates`: emit only `columnOrder`, or `chartType` plus `fieldMapping`.
- e2e fixtures: every `POST .../outputs` config I grepped uses known keys (for example hel1275 metric `{fieldMapping:{}, aggregation:{value,agg}, format}`). The `legend` and `tooltip` hits in e2e and helio-mcp are panel `appearance.chart`, not Output config.
- Live, in the editor UI: I switched an aggregated bar chart to Scatter and saved. The result was 200, the stored config has `aggregation: null`, and the sheet closed (D7 works end to end).

**Changed test fixtures (point d)** are contract changes, not tests edited to pass:
- The `OutputRoutesSpec` HEL-877 test is replaced by a shallow-merge test plus a new test that each of the four dead keys returns 400 and persists nothing.
- HEL-946 keeps its echo assertion, with a known key in place of the dead one.
- In `OutputCompareWriteValidationSpec`, the 400 still comes from the stored invalid `compare` because `label` is a known metric key, so the test still exercises the path it names.
- `OutputHistoryPayloadsAvailableSpec`: the spoofed keys are now rejected (400), and the server field is asserted unchanged by a follow-up GET or rename.

**Schemas (point e).**
- The create, update and transactional request schemas list the union of known keys, `aggregation` as oneOf null/chart/metric (`additionalProperties:false` inside each shape), and the `chartType` enum.
- `config` deliberately does not set `additionalProperties:false`, which is consistent with D3.
- The `output.schema.json` description no longer claims the legend deep merge.

**Gates I re-ran myself.**
- Backend `sbt testOnly` over 13 suites: OutputConfigKeyValidation, OutputConfigValidation, OutputRoutes, OutputCompareWriteValidation, OutputHistoryPayloadsAvailable, PatchSetApplyService, RefinementEditShape, AssistantProposalToolSchemas, FirstRun*, PersonaTemplates*. Result: 291 tests, 0 failed. The embedded Postgres started and ran migrations, so the tests actually executed and were not served from cache.
- Frontend `jest src/features/pipelines/ui/outputEditor` (maxWorkers=3): 9 suites, 119 tests passed.
- For the full-suite counts (6150 backend, 4903 frontend, helio-mcp 404) I relied on the evaluator's pasted results. They rest on a content diff showing no backend or frontend change after `420524f8a`, not on mtimes.

**UI judgment.**
- The only UI change is the text of the editor's existing save-error `InlineError`, which now shows the server message. It renders in the same slot, with the same token-driven component, as the old generic text. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1313/evidence/skeptic-final-saveerror-dark.png`.
- I did not check light/dark parity, because no styling changed.
- Console: one error, a 404 on `/schedule` for a pipeline with no schedule. It is pre-existing and unrelated.

### Verdict: CONFIRM

### Non-blocking notes
- **Kind select in edit mode (pre-existing, newly visible).** In `OutputEditorSheet.tsx` (~L509-516) the Kind select stays enabled when editing an existing Output, but `PATCH` cannot change `kind`. Switching a chart to Table and saving now shows "Unknown config key for a chart Output: `columnFormats` (not a chart config key)…" (screenshots `skeptic-final-kindswitch-dark.png` and `skeptic-final-saveerror-dark.png`), and nothing is stored. I verified this by GET afterwards. Before this change the same action could not change the kind either. The new 400 stops wrong-kind keys from being stored, which is an improvement, but the message is developer-facing for an end user. Recommend a follow-up ticket: disable Kind in edit mode, or support a real kind change.
- The carried evaluator nits (the long chained line in `PipelineService` L681, the comment wrap in `PatchSetPreviewProjection`, "both prompts" in design.md) remain cosmetic.
- I did not check helio-news `build.py`, as flagged in the design's Risks section. The owner should expect 400s for any dead keys it sends.
- **Dev-DB residue I created**, by exact id:
  - user email `skeptic-hel1313-1791458646247@example.test`
  - data source `3b638fd5-fb97-4bc5-8b0c-b00f9da92685`
  - pipeline `03ff2e09-1d35-4c85-9671-4c5d48d3126d`
  - outputs `95b898f3-f39a-4ec0-a919-6d1c97733c6f` (chart, now scatter) and `3f0f1096-4e87-4b3e-9cb1-1080623a2fb6` (metric)
  - plus one pipeline run
