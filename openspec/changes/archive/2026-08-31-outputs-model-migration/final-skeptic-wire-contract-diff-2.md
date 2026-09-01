## Skeptic Report — final gate, axis: wire-contract diff (round 2)

HEAD `5977223a` vs `main`. Every statement re-derived with fresh commands in this worktree; round 1's
diff was not reused, and the executor's/evaluator's reports were not consulted for any conclusion.

### What I verified (with evidence)

1. **Round-1 CR 1 (spec-delta drift) — FIXED, and fixed in the correct direction.**
   `specs/workspace-resource-search/spec.md` now reads: "its result kinds no longer include `metric`
   (Metrics were deleted outright); the `dataType` result kind is RETAINED as a transitional wire
   label — its results are now sourced from `OutputRepository`". That matches shipped code exactly:
   `WorkspaceResourceType.scala:22,33` still maps `DataType ↔ "dataType"` with no `Metric` arm;
   `WorkspaceSearchService.scala:133-137` (`toDataTypeSummary(output: Output)`) emits
   `resourceType = "dataType"` from an `Output`; `WorkspaceResourceSearchProtocol.scala:52,62`
   still writes/reads the `"dataType"` discriminator around a `WorkspaceContextOutput`.
   Cross-checked that retention is the *correct* end state, not a spec bent to a wrong
   implementation: design.md's value-exemption and ticket.md's "Out of scope" both put the 30+
   frontend/MCP consumers outside this ticket, and my own fresh grep confirms the blast radius
   (`grep -rln 'outputDataTypeId|outputDataTypeName' helio-mcp/src frontend/src` = 46 files).
   Renaming here would have been the scope violation.

2. **Round-1 CR 2 (exemption list) — FIXED, and each new entry checks out.**
   `design.md:317-390` now reads "four named wire-field-NAME exemptions ... plus one wire-VALUE
   exemption", with an explicit note that the original "exactly two" framing was incomplete.
   Per-exemption verification:
   - **Ex. 3** `PipelineAnalyzeProposalResponse.outputDataTypeName` — real: the field exists in
     `PipelineAnalyzeProposalProtocol.scala` (`jsonFormat4`), `String`-typed as claimed. Its
     justification is adapted, not copy-pasted: it argues the field is the *sibling* of Exemption 1's
     field on the same proposal-apply flow and renaming one without the other leaves them
     inconsistent. Defensible; P1.4 territory per design.md's own proposal-services scope decision.
   - **Ex. 4** `AssistantProposalToolSchemas`' `"outputDataTypeName"` — real at lines 160, 171, 174,
     192 exactly as claimed (example, property, `required`, second example). Justification is
     specific (Claude-facing mirror kept in lockstep with Ex. 3's HTTP response). Sound.
   - **Value-exemption** the `"dataType"` `resourceType` value — real, and correctly distinguished
     from the field-NAME exemptions; its blast-radius claim reproduces.
   None of the four is a code change dressed as an exemption; all are documentation of surfaces that
   were already standing at HEAD. No scope creep here.

3. **Full re-sweep, this round's delta.** `git diff --stat 971608e5..HEAD -- 'backend/.../api/**'
   'schemas/**'` = 5 files: four package READMEs and `schemas/patch-sets/patch-set.schema.json`.
   The patch-set schema edit removes `dataType` from the `target.kind` enum, which now matches
   `PatchSetProtocol.scala:67-68` `recognizedKinds = Set("panel","dashboard","dataSource","pipeline",
   "pipelineStep")` exactly, and is asserted red-side by `PatchSetProtocolSpec.scala:204-216` (both
   `dataType` and `metric` must raise `DeserializationException`). That is a correctness fix bringing
   schema into agreement with already-shipped code, not new creep.
4. **Full re-sweep vs main.** Route/schema inventory re-derived; unchanged from round 1's findings —
   no new routes, no Output routes leaked in from P1.3, no additional schema files added or removed
   since round 1.
5. **`node scripts/check-schema-drift.mjs` fresh run:** `EXIT=0`, "60 checked across 46 protocol
   files", "panel-type enums in sync ... 7 surfaces". Non-vacuous: it does *not* cover
   `AssistantProposalToolSchemas` (grep for `AssistantProposalToolSchemas|patch-set` in the script
   returns nothing), which is precisely how finding 1 below survived a green run.

### Verdict: REFUTE

One finding. It is narrow and two-literals cheap, but it is a genuine shipped-contract divergence
newly introduced by this branch (not inherited debt), and it was created by this very round's fix.

### Change Requests

1. **`AssistantProposalToolSchemas.scala:224` advertises a patch-set `target.kind` the server now
   hard-rejects.** This round removed `dataType` from `patch-set.schema.json`'s `target.kind` enum
   to match `PatchSetProtocol.recognizedKinds` — correct — but the Claude-facing mirror of that same
   contract was not updated:
   - `AssistantProposalToolSchemas.scala:224`
     `"kind" -> enumSchema("panel", "dashboard", "dataSource", "dataType", "pipeline", "pipelineStep")`
     — still six kinds, still including `dataType`.
   - `AssistantProposalToolSchemas.scala:375` (`proposePatchSetTool`'s description) likewise still
     says "(panel/dashboard/dataSource/dataType/pipeline/pipelineStep)".
   - This is live, not dead: `proposePatchSetTool` is element 7 of
     `AssistantProtocol.assistantTools:100-108`, the vector offered to Claude on every converse turn.
   - The consequence is concrete: a model that follows the tool schema and emits
     `target.kind = "dataType"` gets a `DeserializationException` from
     `PatchSetProtocol.scala:106-109` — a self-inflicted failed turn, from a schema this repo
     authored.
   - It is a **regression, not pre-existing debt**: on `main`,
     `git show main:...AssistantProposalToolSchemas.scala` has the identical line 224, but there
     `dataType` was a *valid* kind. This branch made it invalid on one side only.
   - It is **not covered by any exemption**: Exemptions 1-4 are field NAMES (`outputDataTypeName` /
     `outputDataTypeId`), and the value-exemption is scoped explicitly to
     `WorkspaceResourceType`/`WorkspaceResourceSearchProtocol`'s `resourceType` value — neither
     reaches the patch-set `target.kind` enum. Indeed design.md's own Exemption 4 rationale
     ("this mirror is kept in lockstep with the surface it describes") argues *for* fixing it.
   - Required: drop `"dataType"` from the `enumSchema(...)` at :224 and from the tool description at
     :375, so the tool schema, `patch-set.schema.json`, and `recognizedKinds` all state the same five
     kinds. No `output` kind should be added — design.md/patch-set.schema.json correctly assign that
     to P1.4 (HEL-907). A cheap guard (extending `check-schema-drift.mjs` to compare this enum
     against `recognizedKinds`, or a `PatchSetProtocolSpec` assertion that every kind in
     `EditTargetSchema`'s enum deserializes) would prevent the mirror drifting again, but is
     optional — the two-literal fix is what is blocking.

### Non-blocking notes

- `WorkspaceSearchService.scala:128-130`'s comment still defers the `"dataType"` rename to
  "section 5's schema-surface job, not this task's". Round 1 established there is no such section-5
  task; the deferral is now correctly owned in design.md's value-exemption and the spec delta, but
  this in-code comment still points a future reader at a nonexistent owner. One-line edit to point
  at the design.md value-exemption / P1.4 instead.
- Round 1's three non-blocking notes (em-dash encoding churn; `PublicDashboardRoutes`' now-always-
  absent `dataAsOf` needing a PR-body line for P1.3; `CombinedProposalReview.tsx` as a fourth
  `DATA_PANEL_TYPES` mirror outside task 5.7's file list) are all still open. None blocks.
