# HEL-1390: "Add as tail with aggregate" on a chart writes invalid fieldMapping slots (category/value); assistant examples teach a no-op panel aggregation

## Description

origin_kind: followup
origin_ticket: HEL-1313

Pre-existing issues found during HEL-1313 (verify each):

1. "Add as tail with aggregate" on a chart writes `fieldMapping` slots `category`/`value`, which are not the chart's slot names. This was already broken before HEL-1313; check whether HEL-1313's validation now rejects it (a visible 400) or still stores it.
2. `AssistantProposalToolSchemas` (~L119/L342) dashboard-proposal examples still show a panel-level `aggregation`, which is a no-op; aggregation lives on the Output config. The remodel design doc's "Outputs are render-only" line is stale too.
3. Cosmetic leftovers: a no-op `doc shouldBe a[String]` in `AssistantProposalToolSchemasSpec`, a long chained line at `PipelineService.scala` ~L681, and stale "both prompts" wording in HEL-1313's design.md.

## Acceptance criteria

- (1) Writes valid slots; red-first test.
- (2) Examples are corrected and asserted against the validator's key table.
- (3) Tidied.

## Premise validation (orchestrator, 2026-10-09, origin/main d390a62e)

- (1) Confirmed. Chart slots are `xAxis`/`yAxis` (required), `series`/`annotation` (optional) per `OutputBindingSpec.Chart`. The chart tail path returns a visible 400 and rolls back its aggregate step. It has done so since it shipped: slot validation landed in HEL-906 (#506) before the tail feature in HEL-908 (#508), so HEL-1313 did not cause it and no bad rows can exist from this path.
- (2) Confirmed (L121, L347). Panel-level `fieldMapping`/`aggregation`/`label`/`unit` are all inert on an output panel (`ProposalPanelSupport.buildDataConfig` emits only `{outputId}`). "render-only" stale in docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md and openspec/specs/pipeline-output-sheet/spec.md.
- (3) `doc shouldBe a[String]` and the long line are present. The "both prompts" wording is already gone (design.md now says "all three in-app surfaces"): nothing to do for that bullet.
