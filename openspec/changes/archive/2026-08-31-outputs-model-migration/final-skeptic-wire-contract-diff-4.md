## Skeptic Report — final gate, axis: wire-contract diff (round 4, last human-authorized round)

HEAD `139bea00` vs `main`. Working tree clean (`git status --porcelain` empty). Fresh cold
derivation; rounds 1–3 diffs were not reused. Round 3's report and the executor's fix claim were
read as claims to verify.

Note on filename: `scripts/concertino/next-report-number.sh .../outputs-model-migration
final-skeptic-wire-contract-diff` returns
`FAIL unknown kind "final-skeptic-wire-contract-diff" (expected: evaluation|skeptic-design|skeptic-final)`
— the script does not model this change's multi-axis final-skeptic naming convention (used by
rounds 1–3). This is a script-coverage gap, not an environmental failure: the orchestrator directed
an explicit path and `ls` confirms no `final-skeptic-wire-contract-diff-4.md` exists, so there is no
collision to guard against. Not tagging BLOCKER for it.

### What I verified (with evidence)

1. **Round-3 CR 1(a) — the enum itself IS fixed.**
   `AssistantProposalToolSchemas.scala:51` now reads
   `"type" -> enumSchema("text", "markdown", "image", "output")` — exactly 4 values, `divider`
   correctly excluded per the agent-facing carve-out. A comment at `:44-50` records the ruling.

2. **JSON mirror enum agreement — holds.**
   `schemas/dashboards/dashboard-proposal.schema.json:34` `"enum": ["text","markdown","image","output"]`.
   Byte-equivalent set to the Scala enum. This half of the executor's claim is true.

3. **Round-3 CR 1(b) — the `dataTypeId` description IS fixed on the Scala side.**
   `:53-57` now reads "Required for output panels…". Coherent with
   `DashboardProposalService.scala:159` `DataPanelKinds: Set[String] = Set("output")` (read fresh).

4. **`proposeCombinedTool` description text (`:370-376`) — clean.** No retired panel-type names; it
   describes only the `$pipelineOutput` sentinel mechanism. `proposePatchSetTool` (`:380-386`) still
   reads `panel/dashboard/dataSource/pipeline/pipelineStep`, matching round 3's verified three-way
   agreement. No regression.

5. **`node scripts/check-schema-drift.mjs` fresh run:** `EXIT=0`, "60 checked across 46 protocol
   files", "panel-type enums in sync with backend canonical sets (7 surfaces checked)". Green — and
   still structurally blind to both findings below (all 7 surfaces are JSON files under `schemas/`;
   none reads a `.scala` tool schema, and none inspects `examples` arrays or `description` strings).
   This is HEL-926's gap, confirmed a second time.

6. **Full wire-surface re-sweep vs current HEAD.**
   `git diff --stat main...HEAD -- 'backend/src/main/scala/com/helio/api/**' 'schemas/**'` = 55 files,
   identical inventory to rounds 1–3 (no new routes, no new schema files). This round's own delta
   (`git diff --stat 7c6597b1..HEAD`) touches exactly one wire file
   (`AssistantProposalToolSchemas.scala`, 15 lines); the step-ordering rewire
   (`PipelineStepRepository.scala`, `PipelineRunService.scala`, `PipelineService.scala`,
   `RefinementPrompt.scala`) and the deletion-sweep's spec-delta edits touch **no** wire/API/schema
   file. **No scope creep this round** — that part of the claim holds.

7. **My own fresh broad sweep** over `backend/src/main/scala/com/helio/api/protocols/` for retired
   kinds returned 5 hits: `WorkspaceResourceSearchProtocol.scala:52,62` (`"dataType"` discriminator —
   design.md's explicit wire-VALUE exemption, unchanged, fine), and
   `AssistantProposalToolSchemas.scala:45,88,207`. `:45` is the new explanatory comment. `:88` and
   `:207` are finding 1.

### Verdict: REFUTE

Two findings, both reproduced. The executor's claim "matching the JSON schema mirror exactly;
reports no sibling drift found repo-wide" is **false on both halves**: the enum matches, but the
same file's own worked examples were left contradicting it (an explicit, unaddressed round-3 change
request), and the JSON mirror itself carries substantial sibling drift the round-3 report did not
name.

### Change Requests

1. **`AssistantProposalToolSchemas.scala:88` and `:207` — both live worked examples still demonstrate
   `"type": "metric"`, which this same file's own enum now forbids and the server hard-rejects.
   This is round-3 CR 1(c), verbatim, not done.**
   - `:82-96` `DashboardProposalExample` → wired at `:105` as `DashboardProposalSchema`'s `examples`
     → `:355` `inputSchema` of `proposeDashboardTool` → `AssistantProtocol.scala:100-104`
     `assistantTools`. Live.
   - `:190-217` `CombinedProposalExample` → `:223` → `:375` `inputSchema` of `proposeCombinedTool`.
     Live. Its panel is `{"type": "metric", "dataTypeId": "$pipelineOutput", …}`.
   - Ground truth at HEAD: `domain/model/model.scala:114-119` — `PanelType` is
     `Text | Markdown | Image | Divider | Output`. `metric` does not exist. `ProposalPanelSupport
     .validatePanel:31` calls `PanelType.fromString(panel.type)`, so a model that copies the worked
     example — the strongest instruction signal in a tool schema, and the one the model reaches for
     first — gets a hard validation error on every data panel it proposes.
   - Additional latent effect: `metric` is also outside `DataPanelKinds = Set("output")`, so
     `validatePanel:35`'s "data panel must carry a dataTypeId" check is skipped for it and
     `CombinedProposalService.scala:123`'s sentinel routing treats it as a non-data panel — the
     example's `dataTypeId`/`$pipelineOutput` would be mis-routed even before the type rejection.
   - The file is now **internally self-contradicting**: `:51` says the only data type is `output`;
     `:88`/`:207` demonstrate `metric`. That is strictly worse for the model than either state alone.
   - Why it stayed green: `AssistantProposalToolSchemasSpec` decode-pins the `examples` arrays
     through the spray-json *format* only (`examplesOf`, `:24-31`) — `ProposalPanel.type` is a plain
     `String`, so `"metric"` decodes fine. The pin never calls `PanelType.fromString` or
     `validatePanel`, so it cannot catch this class at all.
   - **Required:** change both examples to `"type": "output"`. Per
     `ProposalPanelSupport.buildDataConfig`, an `output` panel's `dataTypeId` routes into
     `{"outputId": …}`, so `:88`'s `"dataTypeId": "dt_example_from_find"` and `:207`'s
     `"$pipelineOutput"` stay valid as-is. Then **extend `AssistantProposalToolSchemasSpec` to run
     each dashboard/combined example panel through `ProposalPanelSupport.validatePanel` (or at
     minimum `PanelType.fromString`)**, so the pin is failable by mutation — without that, this is
     the third stale-literal instance in this one file across three rounds behind a green gate.

2. **`schemas/dashboards/dashboard-proposal.schema.json` — enum fixed, but ~9 sibling `description`
   strings still document retired panel kinds and the wholesale-deleted Metrics concept.**
   Round 3 treated this file as "already-verified"; it verified the enum only. Fresh grep:
   - `:39` `dataTypeId` — "Required for **metric/chart/table/collection/timeline** panels … Omitted
     for text/markdown/image/**divider**." Directly contradicts `:34`'s own enum and
     `DataPanelKinds = Set("output")`. Note the Scala mirror's equivalent line (`:53-57`) WAS fixed —
     so the two mirrors now disagree in the opposite direction from round 3's finding.
   - `:41-43` `metricId` — an entire property documenting binding "to a defined metric via the same
     MetricPanelConfig/ChartPanelConfig/TablePanelConfig metricId slot". Metrics were deleted
     wholesale by this change. (Its Scala twin, `:60` `"metricId"`, is round 3's still-open
     non-blocking note; together they are a live agent-facing surface for a concept that no longer
     exists.)
   - `:47` `fieldMapping` — "metric {value,label?,unit?}; chart {xAxis,yAxis,series?}; table {columns}".
   - `:51` `aggregation` — "metric/chart only".
   - `:66-84` `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors` — all "chart panels only".
   - `:88`/`:92` `label`/`unit` — "for a metric panel".
   - `:97` `sort` — "timeline panels only".
   - `:104` `config` — "collection {baseType,layout}; timeline {timelineOptions:{sort}}; chart
     {chartOptions}; table {density,columnOrder} … EXCEPT a metric/chart/table/collection/timeline
     panel's dataTypeId".
   - **Required:** rewrite these descriptions against the `text|markdown|image|output` reality (or,
     for properties that only ever served a retired kind, remove the property from the schema and
     from `ProposalPanel`), and make the same decision consistently in the Scala mirror's
     corresponding property list at `:58-74`. A caller reading this contract today is told to build
     panels the server rejects.

### Non-blocking notes

- Round 3's non-blocking note (`metricId` carried through `DashboardProposalProtocol.scala:22,70,94`)
  is now folded into CR 2 rather than left as a note, because the JSON contract *documents* it
  rather than merely carrying it inertly.
- `scripts/concertino/next-report-number.sh` does not recognize this change's multi-axis
  `final-skeptic-<axis>-<n>` convention (see header note). Worth reconciling upstream in Concertino.
- Round 1/2's remaining stylistic notes (incl. `WorkspaceSearchService.scala:128-130`'s stale
  "section 5" deferral comment) are all still open. None blocks.
