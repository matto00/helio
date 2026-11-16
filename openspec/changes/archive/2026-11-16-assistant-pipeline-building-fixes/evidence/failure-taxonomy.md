# HEL-1639 failure taxonomy (task 0.2, constraint C3)

Method: the transcript's failing calls were replayed through the real `AssistantToolExecutor` against an
EmbeddedPostgres mirror of the Standings workspace (`AssistantStandingsFixture` +
`AssistantTranscriptReplaySpec`, commit 5b9b1437f; no model call, no `.env`, branch-point main code 8fff8eed1). The replay
spec printed the outcomes below; after the fixes it was replaced by the asserting specs named in the dispositions.. Each row is the
exact `PROBE` output of that spec. No cause differs from design.md.

| # | Transcript call | Replay input | Exact outcome at branch point | Confirmed cause | Fixed by |
|---|---|---|---|---|---|
| 1 | propose_patch_set, chart panels on the TABLE Output with panel-level `fieldMapping`/`aggregation` | panel create, `patch.dashboardId`, `config:{outputId:<table output>, fieldMapping, aggregation}` | **accepted** at propose; the previewed `after.config` is `{controls:[], outputId}` -- `fieldMapping` and `aggregation` are silently dropped | chart shape lives on the Output; a panel binds `outputId` only, and a panel-level shape is discarded without a word (so the model believed it had made charts) | D3 reject, D7 prompt model |
| 2a | propose_patch_set `target.parentId` shape | `target:{kind:panel,parentId:<dashboard>}`, no `patch.dashboardId` | `edit 0: dashboardId is required` | the error names the field but not where it goes; `target.parentId` is not rejected on a panel create, it is just not the dashboard source | D3 error text |
| 2b | propose_pipeline root `{sourceId, type:"dataset"}` | | `roots[0]: specify either sourceId or an inline type, not both` | the error is already clear; the 4x repeat came from fan-out of parallel identical proposals, not from the message | D5 (one propose per response); D3 root schema stated strict |
| 3a | step `passthrough` | | `step 1: invalid type 'passthrough'. Allowed values: aggregate, analyzewithai, assert, ... join, ... groupby, ...` (27 kinds) | the error lists every registered kind, including non-authorable ones (`join`, `groupby`) | D4 authorable-only list, D3 enum |
| 3b | `lookup` with `config: {}` | | **accepted** at propose (echoed back) | `PipelineProposalService.validateStep` runs only `rawConfigProblem` (shape), never `PipelineAnalyzeService.stepConfigProblem` (declared required keys); `aggregate {}` and `join {}` are accepted the same way | D4 full StepConfigValidation |
| 3c | `compute` `record.settings.fpts_decimal` | | `step 1: compute: invalid expression: Invalid number literal: .` | invented grammar is rejected, but the message neither names the grammar nor shows `$column` | D3 grammar + examples, D4 |
| 3d | `compute` `'settings.fpts_decimal'` | | `step 1: compute: invalid expression: Unexpected character: '''` | same: single-quoted strings are not in the grammar (double quotes are) | D3 grammar + examples |
| 3e | `select` naming `metadata.team_name`, `display_name` on the raw source | | **accepted** at propose | propose validates no column against a node schema; apply-time failure is HEL-1638's territory | D1 gives the model `outputSchema` per node; the column check stays with HEL-1638 (won't fix here) |
| 4 | get_resource(pipeline) | | `"laneTree":[]`, `steps:[{outputColumns:[...], position:0, type:"lookup"},{... position:0, type:"compute"}]` | `getPipelineResource` calls `buildPipeline(summary, user)` with the default empty maps, so the lane tree is always empty; steps carry no ids, configs or parents (both positions are 0 because position is per lane); no Output list | D1 |
| 5 | Output id passed as `roots[].sourceId` | root `sourceId` = the Output id | `roots[0]: data source not found` | an Output id is looked up as a data source; the message does not say it is an Output or where to go instead | D4 Output-as-root error |
| 6a | propose_dashboard `dashboardName:"Standings"` over the existing dashboard | | **accepted**; echoes the name. `DashboardProposalService.apply` calls `dashboardService.create` unconditionally | propose_dashboard always creates a NEW dashboard; the tool description never says so | D3 descriptions, D7 prompt |
| 6b | adding an Output to an existing pipeline | `target:{kind:output,parentId:<pipeline>} op:create` | `edit 0: create is not supported for output` | no propose path exists for "add Output to pipeline X at node N" | D2 output create |
| 7 | 4x parallel propose_pipeline in one response | | each of the four runs (`Future.traverse`); each failure repeats 4x | `ClaudeClient.sendWithTools` runs every tool_use of a response concurrently | D5 |
| 8 | proposal passes, apply fails (`display_name` missing at the node) | | not replayed | HEL-1638 | not folded in |
| 9 | find("Fantasy Football standings dashboard") | `resourceTypes:["dashboard"]` | `[]`; find("Standings") returns the dashboard | `matchesQuery` is one contiguous substring of the whole query | D6 |
| 10 | overclaiming | | | model behaviour; no tool-side cause | D7 prompt line only |

## Task 0.3: does analyze project a configured lookup's added column?

Yes. `get_resource(pipeline)` on the fixture returns the lookup step with `outputColumns` ending in
`display_name` and the compute step with `display_name, points_for`. `analyzeNodes` projects a configured lookup's
added column at the lookup node, so the D1 node schemas and the D2 column check are sound and need no prior fix.

## Differences from design.md

None. One refinement the probe adds: item 1's panel-level `fieldMapping`/`aggregation` is not rejected today, it is
silently dropped from the previewed panel, which is why the model believed its chart panels were fine. D3's reject
is therefore a behaviour change on the propose/preview path, not only a clearer message.

## Taxonomy dispositions (for the PR)

Each of items 1-7 and 9 has a fix and a test; 8 and 10 are not fixed here, on purpose.

| # | Disposition | Fix (main code) | Test |
|---|---|---|---|
| 1 | **Fixed.** Wrong model of panels vs Outputs. A panel create with panel-level `fieldMapping`/`aggregation` is now rejected with "chart shape belongs on the Output (kind + fieldMapping)" instead of being silently dropped; the prompt states source -> pipeline -> Output (kind + fieldMapping) -> panel (outputId only); `OutputShapeDoc` (generated from `OutputBindingSpec`) tells the model the slot names per kind. | `PatchSetPanelResolvers.rejectMisplacedShape`, `AssistantSystemPrompt.ModelSection`, `AssistantProposalToolSchemas.OutputShapeDoc` | `PatchSetOutputCreateSpec` ("reject panel-level fieldMapping/aggregation") |
| 2 | **Fixed.** Argument shape. `target.parentId` on a panel create is rejected naming `patch.dashboardId`; the `EditTarget.parentId` text now says which kinds take it; the `propose_patch_set` and `propose_pipeline` schemas are strict (`additionalProperties: false`) with the root rule ("`sourceId` alone OR `type`+`name`+`config`, never both") in the root description. The `{sourceId, type}` error text was already clear (probe), so the 4x repeat is fixed by item 7. | `PatchSetPanelResolvers`, `AssistantProposalToolSchemas` | `PatchSetOutputCreateSpec` ("target.parentId"), `AssistantProposeErrorsSpec` (root shape) |
| 3 | **Fixed.** Invented step types and configs. Step `type` is an enum of the registry's authorable kinds; nine ops carry a strict per-op config schema; `compute` carries the expression grammar and three examples (all executed by a test); propose now runs `StepConfigValidation` plus the authoring rules (`lookup {}`, `aggregate {}`, `select {}` are rejected naming the missing keys). **Won't fix here:** a `select` that names a column no input has is still accepted at propose time -- that is HEL-1638's dry-run apply check; this change gives the model each node's `outputSchema` instead. | `PipelineStepKind.Authorable`, `ProposalStepRules`, `AssistantStepSchemas`, `PipelineProposalService.validateStep` | `AssistantStepSchemasSpec`, `AssistantProposeErrorsSpec` |
| 4 | **Fixed.** `get_resource(pipeline)` returns a populated `laneTree`, ordered `nodes` (id, parent, root, type, config with secret-bearing keys redacted, `outputSchema`, `validationError`) and all `outputs` (kind, node, fieldMapping). Dashboard and Output reads link dashboard -> panel -> Output -> pipeline -> node. | `WorkspaceSearchService.pipelineDetail`, `WorkspaceContextService.dashboardPanels`, `WorkspaceResourceSearchProtocol` (new detail types; the shared `WorkspaceContext*` types are untouched) | `AssistantPipelineReadsSpec`, `SecretRedactionSpec` |
| 5 | **Fixed.** An Output id used as `roots[].sourceId` now says it is an Output, not a data source, names its pipeline and points at `propose_patch_set` (only for an Output the caller can read, owner or pipeline grantee, via `OutputReadAccess`: no cross-tenant leak). The prompt and tool descriptions state the rule. | `PipelineProposalService.validateSourceReference` | `AssistantProposeErrorsSpec` (incl. the other-tenant case) |
| 6 | **Fixed.** `propose_dashboard` always creates a NEW dashboard (apply calls `dashboardService.create` unconditionally); its description says so and points at `propose_patch_set`, which can now ADD Outputs to an existing pipeline (`output` create at an existing step) and bind panels to them on an existing dashboard (`target.ref` + `"$ref:<ref>"`). Preview, apply, rollback and undo all handle the new create. | `PatchSetOutputResolvers.resolveOutputCreate`, `PatchSetRefs`, `PatchSetApplyService`/`Forward`/`Rollback`, `PatchSetPreviewProjection`, `PatchSetUndoService` | `PatchSetOutputCreateSpec` |
| 7 | **Fixed.** Only the first `propose_*` of a model response runs (block order); the rest get an `isError` result that says a turn yields ONE proposal carrying every edit. A corrected propose in the next hop runs normally. The prompt says to put every Output and panel in one `propose_patch_set` and never one proposal per chart. **Won't fix here:** expressing "a NEW pipeline plus panels on an EXISTING dashboard" in one proposal; the ticket's alternative plan stays two proposals. | `ClaudeClient.sendWithTools` (`oncePerResponseTools`), `AssistantService` | `ClaudeClientOncePerResponseSpec` |
| 8 | **Not fixed here** -- proposals that pass propose and fail apply belong to HEL-1638 (dry-run apply checks). The one overlap, an Output's `fieldMapping` columns checked against the node schema, is part of making `output` create correct and is done (`PatchSetOutputResolvers`, `OutputFieldMappingCheck`). | | |
| 9 | **Fixed.** `find` tokenises the query (lower-case, alphanumeric, length >= 2, stop words dropped), matches any token in a name or description, ranks by tokens matched in the name, and falls back to the old whole-query match when no token is left. The prompt asks for short keywords and a broader retry before asking the user. | `WorkspaceSearchService.score`/`Query` | `AssistantPipelineReadsSpec`, `WorkspaceSearchServiceSpec` |
| 10 | **Prompt only** -- overclaiming has no tool-side cause. One rule: say "proposed", not "created". | `AssistantSystemPrompt` hard rules | |

Two deliberate scope notes for the PR: (a) `get_resource(pipeline)` stays owner-only, while `output` create now lets an editor
grantee add Outputs through a patch set (the editor gets the OWNER's view of source schemas so a source they cannot read never
yields a false "column missing"); (b) the REST `POST /pipelines/:id/outputs` is unchanged, so UI drafts behave as before.
