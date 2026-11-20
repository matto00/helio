# HEL-1779 findings (executor)

- **Preview/apply disagreement was in the opposite direction on create.** On main a patch-set `output` create ran
  `OutputFieldMappingCheck.validate` -> `PipelineCreatePreflight.validateOutputConfig`, whose new-pipeline rule
  (`InsightReadsCheck` over `Map.empty`) refuses ANY `reads.outputs`. So a valid read of a stored Output was refused at preview
  although `OutputService.create` would accept it, and a bad id was refused with the wrong, node-suffixed message. Fix: the
  resolver strips `reads` from the config it hands to `OutputFieldMappingCheck` for an insight and judges it with the
  stored-id `InsightReadsCheck` against `listByPipelineInternal`. Update path: preview had no reads check at all (the projection
  already runs `validateConfig`, so the design's extra `validateConfig` call was NOT added: confirmed redundant, guard test
  "out-of-range maxSentences" is green on main).
- **Same-set delete** is a set-level pass (`rejectReadsOfDeletedOutputs`), called next to `rejectEditedOutputNodes` (skeptic note 2).
- **fieldMapping for insight (4.3b):** `OutputBindingSpec.Insight` has no slots, so any slot in `fieldMapping` is refused and an
  empty object/absent is fine; KeysDoc says "no fieldMapping (leave it out)".
- **Refinement (D3):** `RefinementEditShape` offers output UPDATE only ("an output CREATE ... is NOT offered in this flow"), so the
  existing-pipeline constant was not appended there; it gains the insight key docs through `KeysDoc`.
- **Frontend (D8):** the assistant review UI has no OutputKind-keyed map (`PipelineProposalSummary` prints `output.kind` as text;
  `features/assistant` and `features/patchSets` reference no kind table). No change.
- **Double-update edge (skeptic note 5), recorded not fixed:** two updates of one Output in one patch set are judged at preview
  against stored config, at apply against the first update's result. Pre-existing.
- Known broken-by-the-change specs fixed: OutputConfigValidationSpec (insight assertion inverted), RefinementEditShapeSpec,
  AssistantProposalToolSchemasSpec (DocumentedKnownKeys -> KnownKeys), DurationFormatSeamSpec stays green because the insight
  sentence sits before `OutputFormatVocabulary.Doc`.
- Flake note: `AssistantInsightNoRenderSpec` failed once when run inside a very large parallel shard (`api.*`+`infrastructure.*`+`services.*`
  together, cause not captured); passed alone x4 and in the 2451-test `com.helio.services.*` shard.
