## Skeptic Report — final gate, axis: wire-contract diff (round 3, human-authorized extra round)

HEAD `7c6597b1` vs `main`. Fresh cold derivation; round 1/2 diffs were not reused. Round 2's report
was read as a set of claims to verify, not as fact.

### What I verified (with evidence)

1. **Round-2 CR 1 — genuinely FIXED, and coherent.**
   `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala:224`
   now reads `enumSchema("panel", "dashboard", "dataSource", "pipeline", "pipelineStep")` and `:375`
   reads `"EXISTING resources (panel/dashboard/dataSource/pipeline/pipelineStep)"`. Three-way
   agreement confirmed by direct read: `PatchSetProtocol.scala:67-68`
   `recognizedKinds = Set("panel","dashboard","dataSource","pipeline","pipelineStep")`, and
   `schemas/patch-sets/patch-set.schema.json:68` `["panel","dashboard","dataSource","pipeline","pipelineStep"]`.
   The example at `:254` uses `"kind": "panel"` — still valid. No `output` kind was added (correctly
   left to P1.4/HEL-907). No new exemption is needed or was added.

2. **Fresh same-class sweep, patch-set/proposal target kinds.**
   `grep -rn '"dataType"\|"metric"' backend/src/main/scala/com/helio/api/protocols/` returns 5 hits:
   - `WorkspaceResourceSearchProtocol.scala:52,62` — the `"dataType"` `resourceType` discriminator,
     covered by design.md's explicit wire-VALUE exemption. Unchanged, in scope, fine.
   - `AssistantProposalToolSchemas.scala:44,81,200` — NOT a patch-set kind, but a **panel-type**
     enum and two examples. This is finding 1 below.

3. **Full wire-surface re-sweep vs current HEAD.** `git diff --stat main...HEAD -- 'backend/.../api/**'
   'schemas/**'` = 55 files, matching rounds 1/2's inventory (no new routes, no new schema files).
   This round's own delta (`git diff b0e75a0e..HEAD -- schemas/ backend/.../api/`) touches exactly
   three wire files: the two-literal `AssistantProposalToolSchemas` fix; a doc-string correction in
   `patch-set-apply-response.schema.json`; and `patch-set-preview-response.schema.json` (doc-string
   plus removal of `dataType` from its `kind` enum, which brings it into agreement with
   `recognizedKinds` — a correctness fix, not creep). The trunk/tail renumbering fix
   (`V94__outputs_model.sql`, `PipelineStepRepository.scala`) touches **no** wire/API file, as
   claimed. No scope creep introduced this round.

4. **`node scripts/check-schema-drift.mjs` fresh run:** `EXIT=0`, "60 checked across 46 protocol
   files", "panel-type enums in sync with backend canonical sets (7 surfaces checked)". Actually
   running, not skipped. Its non-vacuity limit is now pinned precisely: I read
   `scripts/check-schema-drift.mjs:236-270` — all 7 panel-type surfaces are **JSON files under
   `schemas/`**; no surface reads any `.scala` tool schema. That is exactly why finding 1 below
   passes a green gate.

### Verdict: REFUTE

One NEW finding — same defect *class* as round 2's, same file, but a different and materially worse
instance that round 2 did not flag. I re-ran every command behind it; the result is stable.

### Change Requests

1. **`AssistantProposalToolSchemas.scala:44` advertises five panel types the server now hard-rejects,
   and omits the only valid data-bound type.**
   - `:44` `"type" -> enumSchema("metric", "chart", "table", "text", "markdown", "image", "collection", "timeline")`.
   - Ground truth at HEAD: `domain/model/model.scala:132-139` — `PanelType.fromString` accepts only
     `text, markdown, image, divider, output`. So `metric`, `chart`, `table`, `collection`,
     `timeline` are all rejected, and `output` — the one type that can carry data — is **missing from
     the advertised enum entirely**.
   - It is **live and it hard-fails**: `ProposalPanelSchema` (declared `:40`) is the panel schema of
     `proposeDashboardTool`/`proposeCombinedTool`, elements 4 and 6 of
     `AssistantProtocol.assistantTools:100-108`. `ProposalPanelSupport.validatePanel:31` calls
     `PanelType.fromString(panel.type)` first, so a model that follows this enum gets a validation
     error on every data panel it proposes.
   - The two worked examples make it worse, not better: `:81` and `:200` both literally demonstrate
     `"type": "metric"` with a `dataTypeId` — the exact shape the server rejects. `:200` is inside
     `propose_combined`'s example.
   - **Regression, not inherited debt**: `git show main:...model.scala | grep 'Unknown panel type'`
     lists `metric, chart, text, table, markdown, image, divider, collection, timeline` — valid on
     main. `git show main:...AssistantProposalToolSchemas.scala | sed -n 44p` is byte-identical to
     HEAD's line 44. This branch invalidated one side only.
   - **Not exemption-covered**: design.md's four exemptions are field NAMES
     (`outputDataTypeId`/`outputDataTypeName`) and the one value-exemption is scoped explicitly to
     `WorkspaceResourceType`/`WorkspaceResourceSearchProtocol`'s `resourceType`. Neither reaches a
     panel-type enum. This branch already fixed the JSON mirror of this very contract:
     `schemas/dashboards/dashboard-proposal.schema.json` was narrowed to
     `["text","markdown","image","output"]` — the Scala mirror was simply missed.
   - **Required:**
     a. `:44` → `enumSchema("text", "markdown", "image", "output")`, matching
        `dashboard-proposal.schema.json`'s agent-facing set exactly (no `divider`, per the existing
        agent-facing carve-out the drift checker encodes at `check-schema-drift.mjs:218-223`).
     b. Update the `dataTypeId` description at `:46-51` — it currently says "Required for
        metric/chart/table/collection/timeline panels", none of which exist. The real rule at HEAD is
        `DashboardProposalService.scala:159` `DataPanelKinds = Set("output")`.
     c. Fix both examples (`:81`, `:200`) to a shape that actually validates — `"type": "output"`
        with the binding id (`ProposalPanelSupport.buildDataConfig` routes an `output` panel's
        `dataTypeId` into `{"outputId": ...}`).
     d. **Strongly recommended, and the reason this class keeps recurring:** add this Scala enum as
        an 8th panel-type surface in `check-schema-drift.mjs`. Two rounds have now each found one
        stale enum in this one file behind a green gate; a third instance is likely without a guard.

### Non-blocking notes

- `AssistantProposalToolSchemas.scala:53` still advertises a `metricId` property, and
  `DashboardProposalProtocol.scala:22,70,94` still carry `metricId` through `ProposalPanel`, though
  Metrics were deleted and `DashboardProposalService.scala:156` notes `MetricIdSupportedKinds` was
  removed. It is inert (parsed, then unused) rather than an error, so it does not block — but it is
  dead agent-facing surface worth removing alongside CR 1.
- Round 2's non-blocking note (the stale "section 5" deferral comment in
  `WorkspaceSearchService.scala:128-130`) and round 1's three notes are all still open. None blocks.
