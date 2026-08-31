## Skeptic Report — final gate (round 4, axis: deletion-sweep completeness)

HEAD verified: `139bea00`, working tree clean (`git status --porcelain` empty). Every command below
re-run fresh; no conclusion inherited from the executor's report or from rounds 1–3.

### What I verified (with evidence)

**1. Round-3 CR1 (116 `Output/node` sed artifacts) — FULLY FIXED.**
- The named grep returns 5 hits, all in `metric-crud-api/spec.md`, all legitimate prose
  ("…carries into the Output's config.format"). Agrees with round 3's own reading.
- `grep -rn "Output/node" openspec/changes/outputs-model-migration/specs/` → **0 hits** (was 116).
- **My own broader sweep, not one I was pointed at:** I enumerated *every* slash-joined token across
  all 71 delta files (`grep -rhoE "[A-Za-z_]+/[A-Za-z_]+" | sort | uniq -c`) and inspected every
  candidate artifact (`Outputs/node_snapshots`, `Output/pipeline`, `DataType/companion`,
  `DataTypes/Metrics`, `update/dataType`, `OutputRepository/PipelineStepRepository`). All are
  deliberate prose or real identifiers. `grep -rn "\ba Output\|\ban Output/\|\ba output\b"` → 0 —
  the article fix-ups that gave the sed away are all done. **No residual corruption of this class.**
- I also extracted every backticked `*Output*` identifier in the deltas and cross-checked each
  against source: `evaluateForOutput`, `listEnabledByOutputInternal`, `panels.output_id`,
  `target_output_id`, `PassthroughShape.outputContract`, `place_outputs`,
  `findLastRunAtByOutputDataTypeId` (cited only inside `## REMOVED`) — all real or correctly
  historical.

**2. `resource-tagging/spec.md` — CORRECT, cross-checked against source.**
`OutputRepository.scala` (at `infrastructure/persistence/pipelines/`) line 44/55 `domainToRow(…,
tag)` and line 134 `tag: Option[String] = None` confirm the write side; `model.scala:750` shows the
`Output` case class carries **no** `tag` field, and the repository's own comment at :84–86 states
the column "is not yet read out". The new note at :22–26 states exactly this and files no phantom
ticket ("No ticket is currently filed"). **Round-3 CR3 closed.**

**3. `patch-set-preview/spec.md` — round-3 CR2 fixed, but a NEW false `SHALL` survives. See CR2.**
The `dataType` clauses and their three scenarios *are* correctly moved to `## REMOVED Requirements`
with reasons I verified independently (`find backend/src -name "DataTypeService*"` → nothing;
`PatchSetProtocol.scala:67-68 recognizedKinds = Set("panel","dashboard","dataSource","pipeline",
"pipelineStep")`; `TextPanel/MarkdownPanel/package.scala:8` record the `dataTypeId` removal).
The "Impact hints" requirement I checked line-by-line against `PatchSetPreviewImpact.scala:16-66` —
it matches the shipped rule set exactly. But the surviving positive requirement is not clean (CR2).

**4. `openspec validate outputs-model-migration --type change --strict` → `Change
'outputs-model-migration' is valid`.** Fresh run after this round's edits.

**5. AC 6.1 grep, run verbatim and fresh.** 7503 raw hits; after excluding `db/migration/**`,
`hel904-real-dump.sql`, `backend/src/test` and comment lines, exactly **15 code hits in 6 files**
plus one history sentence in `services/panels/README.md` — byte-for-byte the same
Exemption-1/Exemption-2 wire-field-NAME set rounds 2 and 3 found. **AC 6.1 holds.**

**6. Compile + full suite, fresh single-threaded clean run (HEL-924 protocol).**
`sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` →
`Total number of tests run: 3352`, `Tests: succeeded 3352, failed 0`, `EXIT=0`. (+4 vs round 3's
3348 — this cycle's `executionOrder` guards.)

**7. Phantom-deferral sweep on everything new this cycle.** Each target grepped, not trusted:
`resource-tagging`'s read-side note names no ticket (honest); `patch-set-preview`'s REMOVED reasons
cite tasks 3.3/4.1, both real and verified in source; `AssistantProposalToolSchemas`' new comment
cites `final-skeptic-wire-contract-diff-3.md item 5` and the remodel design doc — the report exists
and the finding is real (it is that report's CR 1). **No seventh phantom-deferral instance.**

### Verdict: REFUTE

Two findings. CR1 is the serious one: it is a **previously-named, explicitly-required fix that this
round claimed to make and did not**, and the partial fix left a shipped agent-facing contract
self-contradictory in a way it was not before.

### Change Requests

1. **`AssistantProposalToolSchemas.scala` now contradicts itself: the panel-type enum was narrowed
   to `output` but both worked examples still say `"type": "metric"`.**
   Round 3's wire-contract report (`final-skeptic-wire-contract-diff-3.md:49-88`) required four
   things under its CR 1. The executor did (a) and (b) and **silently skipped (c)**, which read:
   > c. Fix both examples (`:81`, `:200`) to a shape that actually validates — `"type": "output"`
   >    with the binding id.

   Ground truth at HEAD:
   - `AssistantProposalToolSchemas.scala:51` — `"type" -> enumSchema("text", "markdown", "image",
     "output")` (correctly fixed this round).
   - `AssistantProposalToolSchemas.scala:88` — `DashboardProposalExample`, published as
     `DashboardProposalSchema`'s `examples` array (`:104`), i.e. the *same JSON Schema object* whose
     enum forbids it, still reads `"type": "metric"`, with `dataTypeId`/`fieldMapping`/`aggregation`.
   - `AssistantProposalToolSchemas.scala:207` — `propose_combined`'s example, same defect,
     `"type": "metric"` with `"dataTypeId": "$pipelineOutput"`.

   This is worse than the pre-fix state: before, the enum and the examples agreed (both wrong);
   now the sole worked example a model is shown violates the enum published three lines above it,
   and `ProposalPanelSupport.validatePanel` → `PanelType.fromString` hard-rejects `metric`
   (`DashboardProposalService.scala:159` `DataPanelKinds = Set("output")`). Any model that copies
   the example — the thing examples exist for — fails validation on every data panel.

   Note the green suite proves nothing here: `AssistantProposalToolSchemasSpec` decode-pins the
   examples against `dashboardProposalFormat`, and `ProposalPanel.type` is a bare `String`, so the
   example decodes fine and dies one layer later at `PanelType.fromString`. 3352 green tests do not
   touch this.

   **Required:** rewrite both examples to `"type": "output"` with the binding routed the way
   `ProposalPanelSupport.buildDataConfig` actually routes an `output` panel's id, and drop the
   `fieldMapping`/`aggregation` keys that no longer correspond to anything on a placed Output.

2. **`specs/patch-set-preview/spec.md:7-8` asserts a `SHALL` against a validator this ticket
   deleted — the same defect class round 3 raised, one clause short of fixed.**
   The rewritten ADDED requirement still requires `preview` to reject
   > a panel-update edit combining `chartType: "scatter"` with a set `aggregation` (mirrors
   > `PanelService.validateScatterAggregationConflict`)

   That validator does not exist: `grep -rn "def validateScatterAggregationConflict" backend/src` →
   nothing. It was removed by this very ticket —
   - `PanelServiceHelpers.scala:189-196`: "HEL-904 task 3.9/4.1: … the
     ChartPanel-scatter-aggregation-conflict validators … were removed here";
   - `PatchSetPreviewProjection.scala:110-112`: "HEL-904: the `validateScatterAggregationConflict`
     gate here was removed along with `ChartPanel` — Outputs carry no panel-side `aggregation`
     field to conflict with a chart type."
   - `find backend/src -name "ChartPanel*"` → nothing.

   So `preview` provably does **not** do what this requirement says it `SHALL` do. The executor
   correctly relocated the `dataType` clauses to `## REMOVED` but left this ChartPanel clause in the
   positive requirement, and the accompanying paragraph at :12-15 asserts "the panel/pipeline checks
   it also covered are **unchanged** and restated here" — which is false for this one.
   (The other two clauses are fine: `PanelServiceHelpers.resolvePatch` and
   `PipelineService.updateName` (`PipelineService.scala:100`) both exist.)

   **Required:** drop the scatter/aggregation clause from the ADDED requirement, correct the
   "unchanged and restated" sentence, and record the removal (with the `ChartPanel`-deletion reason)
   alongside the existing `## REMOVED` entries. Also fix the same stale claim in the shipped
   scaladoc at `PatchSetPreviewProjection.scala:34`, which still lists "blank-title/cross-type-PATCH
   + scatter+aggregation conflict" as checks that run there.

### Non-blocking notes

- **Round-3 wire-contract CR 1(d) also not done** (it was flagged "strongly recommended", not
  binding): `scripts/check-schema-drift.mjs` still has no reference to
  `AssistantProposalToolSchemas`. Round 3 predicted "a third instance is likely without a guard";
  CR1 above is that third instance. Worth adding with CR1's fix.
- `RefinementEditShape.scala` still ships ~8 Claude-facing worked examples for panel types this
  ticket deleted (`MetricPanelExample`, `ChartPanelExample`, `TablePanelExample`,
  `CollectionPanelExample`, `TimelinePanelExample` at :187–254, plus `MetricPanelCreateExample`
  :273, `ChartPanelCreateExample` :298, `TablePanelCreateExample` :314), all binding via
  `config.dataTypeId`. `tasks.md:260` scoped this file only to the `dataType` **target.kind**, and
  the remodel design doc assigns proposal/patch-set *services* to P1.4 (HEL-907), so I am not
  treating this as blocking for HEL-904 — but it is the same dead-agent-surface class as CR1 and
  should be explicitly carried on HEL-907 rather than left to be rediscovered.
- `AssistantProposalToolSchemas.scala:59` still advertises a `metricId` property (round 3's own
  non-blocking note, still open). Inert, not an error.
- `metric-crud-api/spec.md`'s five identical pasted Migration sentences (rounds 2/3 note) remain;
  cosmetic.
- Everything else on this axis is clean and independently confirmed: the sed corruption is fully
  gone including under my own broader sweep, the AC grep is unchanged from round 2/3,
  `openspec validate --strict` passes, and the full suite is green at 3352/3352.
