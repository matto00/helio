## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md`, then re-derived everything from the live repo (grep/openspec/
  script source), not from the artifacts' citations.
- `npx openspec validate outputs-model-migration --type change --strict` → **"Change
  'outputs-model-migration' is valid"**. Deltas are structurally sound.
- Counted the delta set myself: **36** capability dirs, not 29 — 5 ADDED-only
  (`outputs-model`, `node-snapshot-persistence`, `pipeline-step-tree`,
  `output-panel-placement`, `data-source-persistence`), **14** REMOVED, **17** MODIFIED.
  `tasks.md` 5.5 and the round-2 brief both say "29 (13 REMOVED, 4 new, 12 MODIFIED)".
- **REMOVED coverage is complete** (re-verified, all 14): delta `### Requirement` count equals
  live spec count for every one — `panel-datatype-binding` 28/28, `data-type-persistence` 9/9,
  `panel-type-field` 9/9, `datatype-crud-api` 7/7, `type-registry-content-fields` 7/7,
  `data-type-acl` 6/6, `metric-definition-persistence` 6/6, `panel-viz-aggregation` 6/6,
  `metric-crud-api` 5/5, `bound-panel-composition` 4/4, `panel-capability-introspection` 4/4,
  `type-registry-provenance` 4/4, `datatype-row-snapshot` 2/2, `metric-usage-governance` 2/2.
  No requirement silently dropped. Round-1's coverage finding on REMOVED specs stays closed.
- `grep -rln "DataType\|Metric" openspec/specs` → **115** files; `comm` against the delta set
  leaves **85 uncovered**. Read the DataType/Metric hits in eight of them.
- Read `scripts/check-schema-drift.mjs` end to end (not just the four cited line ranges).
- Grepped every `PanelCapabilityService` reference in `backend/src/main/scala`.

### Verdict: REFUTE

Findings 3 and 4 of round 1 are genuinely closed (tasks 3.8–3.15 are concrete: named file,
named symbol, named action, plus a real design decision bounding the proposal-service rewire).
Finding 2 is substantially closed but not sufficient. **Finding 1 is a repeat — it was
narrowed, not closed** (see the escalation flag on item 1).

### Change Requests

1. **[REPEAT of round-1 finding 1 — escalation trigger]** Backend-facing capability specs this
   ticket's own tasks change still have no delta and no named deferral. The revision added
   deltas for the 12 capabilities I happened to name in round 1, but the *general* gap is
   unchanged: 85 of the 115 DataType/Metric-bearing specs are uncovered, and the deferral is
   still only the unjustified assertion in tasks.md 6.2 ("nothing except specs explicitly owned
   by P1.3/P1.5/P1.6 (list them in the PR)"). These are unambiguously backend and unambiguously
   owned by tasks in *this* change:
   - `acl-enforcement:195-215` — "ACL directive covers DataSource and **DataType** resource
     types", `DataTypeRepository.findByIdInternal` resolver. Task **3.15** deletes exactly
     that. (`acl-resource-type-registry` got a delta; its twin did not.)
   - `pipeline-execution:4,10,17,19,24,35` and `pipeline-run-execution:81,144-154` — the whole
     capability is "the run writes the output **DataType's** schema/version". Tasks 2.10/3.5
     delete `pipelines.output_data_type_id`.
   - `patch-set-apply:55-67,120,137-143`, `patch-set-preview`, `patch-set-undo` — companion-
     DataType rejection, `DataTypeResponse` priorState, `outputDataTypeName`. Task **3.3**.
     (`patch-set-contract` got a delta; the three apply/preview/undo specs did not.)
   - `workspace-context-assembly:4,13,21,28,38,49` — names DataTypes and `DataTypeRepository`
     directly. Task **3.12**.
   - `schema-inference-facade:55` — "`DataType`'s fields from an `InferredSchema`". Task **4.3**.
   - `rls-privileged-bypass:62` — names `DataTypeRowRepository` as a privileged-pool caller.
     Task **4.1**.
   - `resource-tagging:4,8-9,18,22,48` — `DataTypeService` create path accepts `tag`. Task 4.1.
   - Also plausibly in-scope and unowned: `pipeline-analyze-api`, `pipeline-list-api`,
     `pipeline-compute-op`, `pipeline-schema-drift`, `pipeline-proposal-contract`/
     `-apply`/`-analyze-api`, `combined-proposal-apply`, `assistant-conversation-loop`,
     `panel-data-freshness`, `dev-db-repair`.
   Required revision: stop enumerating reactively. Commit the full `grep -rln` list into the
   change dir and mark **every one of the 115** as either (a) delta in this change, or (b)
   deferred to a *named* P-ticket with a one-line reason. As written AC 6.2 cannot pass.
   *Flagging per the orchestrator's "same item survives a round" rule: this is the same
   finding, re-scoped rather than resolved.*

2. **The `check-schema-drift.mjs` fix (tasks 5.4/5.7) is not sufficient — a "narrow kind-list
   edit" does not keep it green.** Re-reading the real script, three things beyond the four
   cross-surface constant lists break, none of which design.md or tasks.md mentions:
   - `scripts/check-schema-drift.mjs:198-205`: `if (canonicalPanelTypes.length < 8) { …
     process.exit(1) }`. The new set is 5 kinds (`output|text|markdown|image|divider`), so the
     script **hard-exits before any surface is compared**, regardless of the 5.7 edit. The
     guard threshold (and its error message) must change.
   - `:181-189`: `canonicalPanelTypes` is parsed by `extractBetween(modelSrc, "def
     fromString(s: String)", "def asString(t: PanelType)")` plus a `case "x" => Right` regex.
     Task 3.6 collapses `PanelType`/`PanelBindingSpec` — if those method markers move or are
     renamed (`PanelKind`), the extraction throws. Name this in 5.4.
   - `:232-263`: the three `panelTypeSurfaces` read the JSON pointer
     `["properties","type","enum"]` (and `["properties","panels","items","properties","type",
     "enum"]`). Task 5.2 renames that field to `kind`, so `getEnumAt` must be re-pointed.
   - **New uncovered file:** `schemas/dashboards/dashboard-proposal.schema.json`
     `$defs.ProposalPanel.properties.type.enum` (`:246-257`) is compared against
     `agentFacingPanelTypes` and appears in **no** task (5.2 lists only `panel.schema.json`,
     `create-panel-request`, the batch pair, `bound-panel-*`, `panel-capabilities-response`,
     `panel-query`). It will fail the gate.
   Required revision: rewrite 5.4/5.7 to enumerate these four items concretely, and drop
   design.md's claim that "a bare string-array change satisfies both".

3. **Task 3.11 contradicts the `panel-capability-introspection` REMOVED delta.** 3.11 says to
   *rewire* `PanelCapabilityService` "to resolve capabilities against a pipeline node's
   Outputs" and keep it compiling. But the delta removes the capability outright (4/4
   requirements), and its only non-comment consumers in the live tree are
   `ApiRoutes.scala:267` (construction) and `routes/pipelines/DataTypeRoutes.scala:12` — both
   deleted by 4.1/4.2. Rewiring it would resurrect a deliberately-removed capability with no
   caller and no spec, violating decision 11's no-shim rule. Change 3.11 to **delete**
   `PanelCapabilityService` + `api/protocols/panels/PanelCapabilityProtocol.scala`, and note
   the stale `PanelBindingSpec.scala:32,103-119` doc comments that reference it.

4. **[Partial repeat of round-1 finding 4] The forward references now point at tasks that do
   not contain the referenced work.** 1.1 says `Pipeline.outputDataTypeId` "is removed in task
   3.5"; 3.5's text is "`PipelineRepository.create` stops minting a type; `PipelineService.
   create` drops `outputDataTypeName`" — no domain-field removal. 1.4 says
   `targetDataTypeId` "is removed in task 3.1"; 3.1's text is the `evaluateForDataType` →
   `evaluateForOutput` rename — no field removal. Add the two removals explicitly to 3.5 and
   3.1.

5. **`tasks.md` 5.5's own count is wrong** — "all 29 capability deltas … (13 REMOVED, 4 new, 12
   MODIFIED)" vs. the actual 36 dirs (14 REMOVED, 5 ADDED-only, 17 MODIFIED). Since 5.5 is the
   executor's checklist for what to archive, correct it (or make it derive the count rather
   than hardcode it).

### Non-blocking notes

- `openspec validate --strict` passes; the delta *content* quality is good, and REMOVED
  coverage is provably complete. My objection remains breadth, not correctness.
- `data-source-persistence` is listed under "Modified Capabilities" in `proposal.md` but its
  delta is `## ADDED Requirements`. Harmless, but the proposal's bookkeeping and the delta
  disagree.
- Section 0 ("Round-2 revisions") is a meta-section whose items are already done; it will read
  as unchecked work to the executor. Consider deleting it once the revision lands.
