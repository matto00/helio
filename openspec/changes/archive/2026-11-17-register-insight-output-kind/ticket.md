# HEL-1740: Insight L1: register the `insight` Output kind and validate its config (no rendering)

## Description

First leaf of HEL-921 (Insight Outputs). Add `insight` as an Output kind that can be created, validated and placed on a
dashboard. It does not render any text yet.

Config:

* `preset` (default `auto`) and an optional `prompt`
* `reads: {outputs[], windows[]}`: sibling Outputs in the same pipeline, at most 8, defaulting to the same node
  (owner ruling D7)
* `refresh: on_run | daily | manual`, default `on_run` (D4)
* `maxSentences` (default 2) and a `maxChars` ceiling

The kind has no fieldMapping slots.

Driver update 2026-11-17 (latest ticket comment, supersedes the 22:44 owner-ruling comment for this leaf): leave the
`model` config key OUT of L1. HEL-1755 owns the shared model catalog/allow-list; L4 (HEL-1743) adds `model` later.

## Acceptance Criteria

* Fail-first: `POST` creating an insight Output returns 400 before the change and 201 after.
* Each of these returns 400 naming the key: an unknown config key; `reads.outputs` naming another pipeline's Output;
  `reads.outputs` naming the insight itself.
* A drift test pins every Output-kind enumeration site. Dropping `insight` from any one site fails it, with the
  mutation recorded.
* Placed on a dashboard, the insight panel shows a "not yet rendered" state.
* The summary reducer stores null metric/series for insight.
* No model call anywhere.

## Migration

V138 widens the `outputs.kind` CHECK constraint. V138 is reserved for this ticket (V139 HEL-1742, V140 HEL-1755).

## Agent notes (from the ticket, re-verified on main 96ed5156b)

There is no Output kind registry. `OutputKind` is a sealed trait (`model.scala:606-642`); OutputFieldContract was removed
in HEL-623. About 15+ hand-written sites, no drift guard:

* Backend: `model.scala`, V94:212 CHECK, `OutputConfigValidation.scala:20-28`, `OutputBindingSpec.scala`,
  `PanelPacker.scala:148` (OutputPanelDefaultSize), `OutputSummaryReducer.summarize`,
  `AssistantProposalToolSchemas.scala:292`, `LegacyOutputConfigKeys.scala:43`.
* Schemas: `outputs/{create-output-request,output}`, `pipelines/{create-pipeline-transactional-output-request,
  draft-save-request,draft-save-response,node-capabilities-response}`.
* MCP: `helio-mcp/src/tools/pipelines.ts:152`, `tools/outputs.ts:55`, `tools/pipelineProposal.ts:89`, `types.ts:1106`.
* Frontend: `features/pipelines/types/output.ts:14`, `features/panels/ui/OutputPanelContent.tsx`,
  `features/pipelines/ui/liveOutput/LiveOutputRender.tsx`, `ui/outputEditor/{OutputKindConfigCard,OutputEditorSheet,
  buildOutputConfig,configPatch,outputSheetDraft,OutputPreviewPane}`, `features/pipelines/state/nodeCapabilities.ts`,
  `utils/crossFilterRows.ts`.

An Output's kind can't be changed after creation (archive 2026-10-08-lock-output-kind-edit-mode).
L3 (HEL-1741, merged) added `domain/insights/InsightPreset` (auto, delta, trend, leaders, summary).
