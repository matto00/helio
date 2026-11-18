# Drift mutations (task 3.5)

Each entry: the one-line mutation applied to a pinned site, the command, and the failing output. Every mutation was
reverted after its run (the harness restores the original file text in a finally block; see the final `git diff` clean check).

## B1 OutputKind.asString drops Insight
- Mutation: `backend/src/main/scala/com/helio/domain/model/model.scala`: remove `case Insight => "insight"` from asString
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info]   scala.MatchError: Insight (of class com.helio.domain.model.OutputKind$Insight$)`
  - `[error] Error during tests:`
  - `[error] 	com.helio.domain.model.OutputKindDriftSpec`
- Restored.

## B2 OutputKind.fromString drops insight
- Mutation: `backend/src/main/scala/com/helio/domain/model/model.scala`: remove the insight fromString case
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should asString/fromString round-trip every canonical kind *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## B3 fromString error-message list drops insight
- Mutation: `backend/src/main/scala/com/helio/domain/model/model.scala`: drop insight from the literal Valid values list
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should fromString's error message lists exactly the canonical kinds *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## B4 OutputKind.all drops Insight
- Mutation: `backend/src/main/scala/com/helio/domain/model/model.scala`: drop Insight from OutputKind.all (canonical set shrinks; every other site then has an extra kind)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should OutputConfigValidation.KnownKeys covers exactly the canonical kinds *** FAILED ***`
  - `[info] - should OutputBindingSpec.All covers exactly the canonical kinds, once each *** FAILED ***`
  - `[info] - should fromString's error message lists exactly the canonical kinds *** FAILED ***`
- Restored.

## B5 KnownKeys drops Insight
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala`: remove the Insight KnownKeys entry
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should OutputConfigValidation.KnownKeys covers exactly the canonical kinds *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## B6 OutputBindingSpec.All drops Insight
- Mutation: `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`: drop Insight from OutputBindingSpec.All
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should OutputBindingSpec.All covers exactly the canonical kinds, once each *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## B7 OutputPanelDefaultSize drops Insight
- Mutation: `backend/src/main/scala/com/helio/services/panels/PanelPacker.scala`: remove the Insight default size
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should OutputPanelDefaultSize has a size for every canonical kind *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## B8 V141 live CHECK drops insight
- Mutation: `backend/src/main/resources/db/migration/V141__outputs_kind_insight.sql`: V141 re-adds the CHECK without 'insight' (live pg_get_constraintdef check)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should list exactly the canonical kinds *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S1 output.schema.json kind enum drops insight
- Mutation: `schemas/outputs/output.schema.json`: drop insight from the kind enum
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should carry exactly the canonical kinds in every kind enum *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S2 create-output-request.schema.json kind enum drops insight
- Mutation: `schemas/outputs/create-output-request.schema.json`: drop insight from the kind enum
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should carry exactly the canonical kinds in every kind enum *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S3 create-pipeline-transactional-output-request.schema.json kind enum drops insight
- Mutation: `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`: drop insight from the kind enum
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should carry exactly the canonical kinds in every kind enum *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S4 draft-save-request.schema.json kind enum drops insight
- Mutation: `schemas/pipelines/draft-save-request.schema.json`: drop insight from the kind enum
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should carry exactly the canonical kinds in every kind enum *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S5 draft-save-response.schema.json kind enum drops insight
- Mutation: `schemas/pipelines/draft-save-response.schema.json`: drop insight from the kind enum
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should carry exactly the canonical kinds in every kind enum *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S6 node-capabilities-response description drops insight
- Mutation: `schemas/pipelines/node-capabilities-response.schema.json`: drop insight from the description prose
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should name every canonical kind in node-capabilities-response's description *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S7 create-output-request drops an insight key property
- Mutation: `schemas/outputs/create-output-request.schema.json`: rename the maxChars property (insight key undocumented)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should document every insight key on the create-output-request schema *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## S8 parity fixture drops insight
- Mutation: `frontend/src/features/pipelines/state/__fixtures__/nodeCapabilitiesParity.json`: rename the first insight capability key in the parity fixture
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec com.helio.services.pipelines.NodeCapabilitiesParitySpec"` (in `backend`)
- Result: RED
  - `[info] - should equal what the server computes today (regenerate with HELIO_WRITE_PARITY_FIXTURE=1) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X1 helio-mcp outputs.ts gains insight
- Mutation: `helio-mcp/src/tools/outputs.ts`: add insight to an excluded site
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should helio-mcp kind enums keep the six pre-insight kinds (HEL-1747 L8 owns them) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X2 helio-mcp pipelines.ts gains insight
- Mutation: `helio-mcp/src/tools/pipelines.ts`: add insight to an excluded site
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should helio-mcp kind enums keep the six pre-insight kinds (HEL-1747 L8 owns them) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X3 helio-mcp pipelineProposal.ts gains insight
- Mutation: `helio-mcp/src/tools/pipelineProposal.ts`: add insight to an excluded site
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should helio-mcp kind enums keep the six pre-insight kinds (HEL-1747 L8 owns them) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X4 helio-mcp types.ts gains insight
- Mutation: `helio-mcp/src/types.ts`: add insight to an excluded site
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should helio-mcp kind enums keep the six pre-insight kinds (HEL-1747 L8 owns them) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X5 AssistantProposalToolSchemas gains insight
- Mutation: `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`: add insight to an excluded site
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should the assistant proposal tool schema keeps the six pre-insight kinds (HEL-1747 L8 owns it) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X6 KeysDoc gains insight
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala`: DocumentedKnownKeys no longer excludes insight (KeysDoc documents it)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should OutputConfigValidation.KeysDoc does not document insight keys (HEL-1747 L8 owns it) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## X7 editor create picker gains insight (backend text pin)
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/outputKinds.ts`: add insight to the create picker
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.OutputKindDriftSpec"` (in `backend`)
- Result: RED
  - `[info] - should the Output editor's create picker excludes insight (HEL-1744 L5 owns it; pinned in outputKindDrift.test.ts) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L2 reads check: insight-reads-insight allowed
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightReadsCheck.scala`: accept an insight sibling
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject an unknown id, itself and another insight, naming reads.outputs *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L3 reads check: unknown/foreign ids allowed
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightReadsCheck.scala`: never reject an id missing from the pipeline
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject an unknown id, itself and another insight, naming reads.outputs *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L4 reads check: judges unchanged reads (no tolerance)
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightReadsCheck.scala`: always judge reads, even when unchanged
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should not judge reads the write does not change (dangling reads tolerated) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L5 create skips the reads check
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala`: OutputService.create never checks reads
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 400 an insight reading another pipeline's Output, an unknown id, another insight, or itself; 200 for a same-pipeline sibling (HEL-1740) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L6 update checks reads under RestorePriorStored too
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala`: rollback is judged like a fresh write
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 200 a PATCH of another key on an insight whose reads dangle after the sibling was deleted; a rollback is never refused (HEL-1740) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L7 update never checks reads
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala`: OutputService.update never checks reads
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 400 an insight reading another pipeline's Output, an unknown id, another insight, or itself; 200 for a same-pipeline sibling (HEL-1740) *** FAILED ***`
  - `[info] - should 200 a PATCH of another key on an insight whose reads dangle after the sibling was deleted; a rollback is never refused (HEL-1740) *** FAILED ***`
  - `[info] *** 2 TESTS FAILED ***`
- Restored.

## L8 draft save skips the reads check
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/draft/DraftDiff.scala`: DraftDiff.readsOk always passes
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.DraftSaveApiSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 400 reads.outputs naming an unknown Output, and write nothing *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L9 single-call create skips the reads check
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala`: preflight never checks reads
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.pipelines.InsightPreflightSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject any reads.outputs id for a brand-new pipeline, naming reads.outputs *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L10 insight value validation off
- Mutation: `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala`: validateInsight never parses the config
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 400 an insight create naming the offending key (HEL-1740) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L11 model key accepted
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightConfig.scala`: add a model key to InsightConfig.Keys
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec -- -z HEL-1740"` (in `backend`)
- Result: RED
  - `[info] - should 400 an insight create naming the offending key (HEL-1740) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L12 maxChars range widened
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightConfig.scala`: range 80..1200 -> 80..1300
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject out-of-range values naming the key *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L13 maxSentences default changed
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightConfig.scala`: default 2 -> 3
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should apply every default to an empty config *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L14 previous_run accepted as a window
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightConfig.scala`: previous_run allowed in reads.windows... (falls to OutputCompare.parse which accepts it)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject previous_run, a bad window, more than 4 windows, a duplicate window *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L15 reads over 8 allowed
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightConfig.scala`: reads.outputs cap 8 -> 80
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject more than 8 outputs, a duplicate id, a non-string id *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L17 insight panel default size changed
- Mutation: `backend/src/main/scala/com/helio/services/panels/PanelPacker.scala`: size 6x3 -> 1x1 (guard: add assertion test below)
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should default to a 6x3 panel, with no fieldMapping slots and vacuously bindable *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L1 reads check: self-read allowed
- Mutation: `backend/src/main/scala/com/helio/domain/outputs/InsightReadsCheck.scala`: remove the self-read clause
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.outputs.InsightConfigSpec"` (in `backend`)
- Result: RED
  - `[info] - should reject an unknown id, itself and another insight, naming reads.outputs *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## L16 summary reducer stores a metric for insight
- Mutation: `backend/src/main/scala/com/helio/domain/history/OutputSummaryReducer.scala`: metric computed for insight
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.history.OutputSummaryReducerSpec"` (in `backend`)
- Result: RED
  - `[info] - should store null metric and series for an insight Output (HEL-1740) *** FAILED ***`
  - `[info] *** 1 TEST FAILED ***`
  - `[error] Failed tests:`
- Restored.

## F1 OUTPUT_KIND_SET drops insight
- Mutation: `frontend/src/features/pipelines/types/output.ts`: remove insight from the Record<OutputKind,true> (tsc error)
- Command: `nice -n 19 npx tsc --noEmit -p tsconfig.json 2>&1` (in `frontend`)
- Result: RED
  - `src/features/pipelines/types/output.ts(25,7): error TS2741: Property 'insight' is missing in type '{ table: true; metric: true; chart: true; collection: true; timeline: true; markdown: true; }' but required in type 'Record<OutputKind, true>'.`
- Restored.

## F2 OutputKind union drops insight
- Mutation: `frontend/src/features/pipelines/types/output.ts`: remove insight from the union (tsc error at every insight use)
- Command: `nice -n 19 npx tsc --noEmit -p tsconfig.json 2>&1` (in `frontend`)
- Result: RED
  - `src/features/pipelines/types/output.ts(31,3): error TS2353: Object literal may only specify known properties, and 'insight' does not exist in type 'Record<OutputKind, true>'.`
  - `src/features/pipelines/types/outputKindDrift.test.ts(45,34): error TS2367: This comparison appears to be unintentional because the types 'OutputKind' and '"insight"' have no overlap.`
  - `src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx(310,34): error TS2345: Argument of type '"insight"' is not assignable to parameter of type 'OutputKind'.`
- Restored.

## F3 frontend nodeCapabilities SPECS drops insight
- Mutation: `frontend/src/features/pipelines/state/nodeCapabilities.ts`: remove the insight binding spec
- Command: `nice -n 19 npx jest --maxWorkers=3 outputKindDrift 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/types/outputKindDrift.test.ts`
- Restored.

## F4 frontend sees a schema enum without insight
- Mutation: `schemas/outputs/output.schema.json`: drop insight from output.schema.json (frontend drift reads it)
- Command: `nice -n 19 npx jest --maxWorkers=3 outputKindDrift 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/types/outputKindDrift.test.ts`
- Restored.

## F5 editor create picker gains insight
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/outputKinds.ts`: add insight to the create picker
- Command: `nice -n 19 npx jest --maxWorkers=3 outputKindDrift 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/types/outputKindDrift.test.ts`
- Restored.

## F6 OutputPanelContent loses the insight branch
- Mutation: `frontend/src/features/panels/ui/OutputPanelContent.tsx`: insight falls to 'Unsupported output kind'
- Command: `nice -n 19 npx jest --maxWorkers=3 PanelContent.test 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/panels/ui/PanelContent.test.tsx`
- Restored.

## F7 LiveOutputRender loses the insight branch
- Mutation: `frontend/src/features/pipelines/ui/liveOutput/LiveOutputRender.tsx`: insight falls to 'no live render'
- Command: `nice -n 19 npx jest --maxWorkers=3 LiveOutputRender.insight 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/ui/liveOutput/LiveOutputRender.insight.test.tsx`
- Restored.

## F8 editor note removed
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx`: the 'later release' note disappears
- Command: `nice -n 19 npx jest --maxWorkers=3 OutputEditorSheet.openingState 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx`
- Restored.

## F10 editor offers the History payload toggle for an insight
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`: the toggle would send historyPayloads, which an insight config rejects
- Command: `nice -n 19 npx jest --maxWorkers=3 OutputEditorSheet.openingState 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx (5.07 s)`
- Restored.

## Notes on mutations that were tried and not recorded as guards
- F9 (editor config pass-through): making `buildOutputConfig`'s default arm emit a key, or `buildConfigPatch` return `{}` instead of `null`,
  stays green by design: the patch is diffed against the same builder's baseline, and `handleSave` omits an empty `config`. These are equivalent
  mutants, not guard gaps; the pass-through is guarded by the F10/F8 tests plus the "rename PATCH sends no config" assertion.
- Reads-check "self" clause (L1) initially stayed green because the insight-kind rule subsumed it; the self case now has its own message
  ("must not name the insight itself", asserted by InsightConfigSpec) and L1 is red. L16 (reducer) initially stayed green on a config that
  resolved no metric field; the spec now supplies a metric-resolving config and the mutation is red.

## P1 OutputPreviewPane loses the insight branch
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx`: insight falls to the empty/preview table (tsc exhaustiveness also trips)
- Command: `nice -n 19 npx jest --maxWorkers=3 OutputPreviewPane.insight 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/ui/outputEditor/OutputPreviewPane.insight.test.tsx`
- Restored.

## P2 OutputPreviewPane insight branch placed below the empty-rows return
- Mutation: `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx`: the insight state depends on rows again (no-rows case shows 'No preview rows yet.')
- Command: `nice -n 19 npx jest --maxWorkers=3 OutputPreviewPane.insight 2>&1` (in `frontend`)
- Result: RED
  - `FAIL src/features/pipelines/ui/outputEditor/OutputPreviewPane.insight.test.tsx`
- Restored.

## P3 schema-drift allowance goes stale
- Mutation: `scripts/check-schema-drift.mjs`: allowance names a value that does not drift (must fail, not pass silently)
- Command: `node scripts/check-schema-drift.mjs 2>&1` (in `.`)
- Result: RED
  - `Schema/JsonProtocols drift detected:`
  - `  stale KNOWN_PRE_EXISTING_DRIFT allowance for "insightZ" (it no longer drifts); delete the entry`
- Restored.

## P4 OutputPreviewPane exhaustiveness: a new kind without a branch
- Mutation: `frontend/src/features/pipelines/types/output.ts`: add a union member with no branch (tsc error at the never in OutputPreviewPane and the Record)
- Command: `nice -n 19 npx tsc --noEmit -p tsconfig.json 2>&1` (in `frontend`)
- Result: RED
  - `src/features/pipelines/types/output.ts(26,7): error TS2741: Property 'gauge' is missing in type '{ table: true; metric: true; chart: true; collection: true; timeline: true; markdown: true; insight: true; }' but required in type 'Record<OutputKind, true>'.`
  - `src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx(254,7): error TS2741: Property 'gauge' is missing in type '{ chart: string; table: string; metric: string; collection: string; timeline: string; markdown: string; }' but required in type 'Record<"chart" | "table" | "metri`
  - `src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx(188,11): error TS2322: Type '"gauge"' is not assignable to type 'never'.`
- Restored.
