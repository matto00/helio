## Why

"Add as tail with aggregate" on a chart Output has never worked: it writes `fieldMapping: { category, value }`, but a
chart's slots are `xAxis`/`yAxis`/`series`/`annotation` (`OutputBindingSpec.Chart`). The server rejects the create
with a 400 (since HEL-906, before the feature shipped in HEL-908), the step is rolled back, and the user sees "Failed
to add tail with aggregate." Separately, the assistant's `propose_dashboard`/`propose_combined` worked examples teach
a panel-level `aggregation` (plus `fieldMapping`/`label`/`unit`) that the proposal apply path ignores outright:
aggregation is Output config.

## What Changes

- The chart branch of the aggregate-tail builder writes `{ xAxis: <groupBy>, yAxis: <alias> }`.
- The `propose_dashboard` and `propose_combined` examples bind output panels by `outputId` only, and the combined
  example shows `aggregation` where it lives: on the proposed Output's `config`.
- A test walks every `propose_*` example and asserts it against `OutputConfigValidation.KnownKeys`: no output panel
  carries an Output-config key, and every example Output config passes the validator for its kind.
- Stale "Outputs are render-only" wording corrected in the remodel design doc and the `pipeline-output-sheet` spec.
- Tidy-ups: drop the no-op `doc shouldBe a[String]`; break up the long chained line in `PipelineService`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: tail insertion attaches an Output whose `fieldMapping` uses the kind's real slots.
- `assistant-conversation-loop`: worked examples put Output config on the Output, checked against the key table.

## Non-goals

- Removing the panel-level `aggregation`/`fieldMapping`/`label`/`unit` properties from `ProposalPanelSchema` or
  `dashboard-proposal.schema.json` (a wire-contract change; candidate follow-up).
- Any change to `OutputConfigValidation` or `OutputBindingSpec`.
- HEL-1313's design.md "both prompts" wording: already corrected ("all three in-app surfaces").

## Impact

- Frontend: `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` and its tests.
- Backend: `AssistantProposalToolSchemas.scala`, `AssistantProposalToolSchemasSpec.scala`, `PipelineService.scala`
  (formatting only).
- Docs/specs: `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`,
  `openspec/specs/pipeline-output-sheet/spec.md` (via delta). No API, schema or migration change.
