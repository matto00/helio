# Output-kind enumeration sites and write paths (task 0.2)

Re-enumerated from the tree (grep of every kind literal incl. `timeline`/`markdown` and `OutputKind.`) at 96ed5156b.

## Backend (changed to include insight)
- `domain/model/model.scala` OutputKind (case object, fromString incl. error-message list, asString, new `all`)
- `V141__outputs_kind_insight.sql` (outputs_kind_check, auto-named by V94:211)
- `services/pipelines/OutputConfigValidation.scala` KnownKeys (+ DocumentedKnownKeys, KeysDoc excludes insight)
- `domain/panels/OutputBindingSpec.scala` Insight + All
- `services/panels/PanelPacker.scala` OutputPanelDefaultSize (6x3)
- `domain/outputs/InsightConfig.scala`, `InsightReadsCheck.scala` (new)
- Not a per-kind map, no entry needed: `LegacyOutputConfigKeys`; `OutputSummaryReducer` (already null metric/series unless Metric/Chart; pinned by spec)
- Node capabilities: built from `OutputBindingSpec.All`, so insight flows through; parity fixture regenerated

## Pinned exclusions (later leaves)
- `AssistantProposalToolSchemas.scala:292` kind enum, helio-mcp `tools/outputs.ts:55`, `tools/pipelines.ts:152`, `tools/pipelineProposal.ts:89`, `types.ts:1106`: L8 (HEL-1747)
- `OutputConfigValidation.KeysDoc` (embedded in AssistantProposalToolSchemas, RefinementEditShape): L8
- Output editor create picker (`outputKinds.ts` CREATABLE_KIND_OPTIONS): L5 (HEL-1744)
- Not Output-kind sites (panel kinds / other): `OutputPicker.tsx:32`, `mobilePanelHeights.ts:87`, `ProposalPanelSupport.scala:326`, `panel.schema.json`, `dashboard-proposal.schema.json`

## Schemas
Kind enums: outputs/{create-output-request,output}, pipelines/{create-pipeline-transactional-output-request, draft-save-request ($defs.DraftOutput), draft-save-response ($defs.SavedOutput)}.
Prose + insight keys: create/update-output-request, create-pipeline-transactional-output-request, draft-save-request (config description), node-capabilities-response (description).

## Frontend
`types/output.ts` (OutputKind + OUTPUT_KINDS), `state/nodeCapabilities.ts` (SPECS), `OutputPanelContent.tsx`, `LiveOutputRender.tsx`,
`OutputPreviewPane.tsx`, `OutputKindConfigCard.tsx` (note), `OutputEditorSheet.tsx` (kindOptionsFor), `utils/crossFilterRows.ts` (default branch -> non-filterable; comment).
Fall through unchanged: `buildOutputConfig`/`configPatch` (default `{}` -> an untouched edit sends no config), `outputSheetDraft` TYPE_RESTRICTED_KINDS (insight absent = unrestricted),
`outputRenderInputs`, `historyRowRules`, `conditionalFormatting`. HEL-1733 draft files (`draftSaveRequest.ts`, `useDraftNodeCapabilities.ts`, `analyzeProposalService.ts`, `draftNodeSchema.ts`) carry no kind list.

## The six Output write paths (re-verified against the tree)
1. `OutputService.create`/`update` (also `PatchSetApplyForward`) - reads CHECKED (`checkInsightReads`, ValidateWrite only)
2. `PipelineCreateTransaction` via `PipelineCreatePreflight.validateOutputConfig` - CHECKED (empty pipeline: any reads.outputs id rejected)
3. `DraftSaveTransaction` via `DraftDiff.planOutputs` - CHECKED (`readsOk`, kept stored ids), unchanged-Output short-circuit kept
4. `PatchSetApplyRollback` (RestorePriorStored via OutputService.update) - not checked
5. draft undo `DraftRestore` (allowExplicitIds => RestorePriorStored) - not checked
6. `PatchSetUndoService.restoreBoundOutputs` (raw insert) - not checked
Preview: `PatchSetPreviewPipelineProjection` runs `OutputService.validateConfig` (value/key validation, so a bad insight value 400s in preview) but not the service-level reads scoping (needs the pipeline's Outputs); a preview can pass and the apply 400 on reads. Low impact until L8 opens the proposal surface (skeptic N-d).
