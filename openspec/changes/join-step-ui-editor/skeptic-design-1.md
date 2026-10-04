## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence, against the live tree at ea57dac8)
- Catalog hides join: JoinStep.scala:124 `override def authorable: Boolean = false`; only other override is GroupByStep.scala:95. Catalog service/protocol pass `companion.authorable` through (PipelineStepCatalogService.scala:44). No route-level gate on authorable, so create is not blocked server-side. CONFIRMED.
- Config shape: `JoinConfig(secondaryInput, joinKey, joinType)` (JoinStep.scala:15); decode uses SecondaryInput.decodeStrict(obj,"rightDataSourceId") = legacy hard error. Frontend defaultConfigFor("join") already seeds the correct shape (stepNarrowing.ts ~288). CONFIRMED.
- Left-join semantics: evaluate "left" case emits `Seq(leftRow)` when no matches, no null-filled right columns. Design's wording (differs from lookup's "get null", LookupConfig.tsx:109) is correct. CONFIRMED.
- Pinning tests: backend PipelineStepRegistryCatalogSpec:23-27 and PipelineStepCatalogServiceSpec:35-37 pin {join,groupby}; stepNarrowing.test.ts:647 pins it by regex-parsing backend source (so it will track the flip). rg of `authorable` across backend/src/test, frontend/src, openspec/specs, schemas, e2e finds no other join-unauthorable pin; PipelineDetailPage.test.tsx catalog fixtures contain only authorable:true. openspec pipeline-step-catalog-api / pipeline-step-palette specs are generic (no join mention). StepCard.test.tsx:33-35,570-603 use a local JOIN_OP_TYPE for the fallback branch, as claimed. List complete.
- Seam test can go red: formProposalSeam.test.ts + DashboardApplyProposalFormSeamSpec are the precedent (relative path `../shared-test-fixtures/` from backend, __dirname-relative from mcp). Frontend toEqual with exact key set goes red on a joinKey rename; backend jsonFormat3 readFromWire/writeToWire round-trip goes red on a field rename. Required-red procedure is in D5/3.8. MCP half is only string-level, which is weak but honestly described.
- helio-mcp add_pipeline_step (write.ts:380) lists `join` in the type list only; the config-shape section covers union/lookup but gives no join shape. CONFIRMED.
- OP_TYPES/JOIN_OP_TYPE/pipelineStepToStep (stepNarrowing.ts:100-112, 114, 248, 484-489) match design; STEP_ICONS derives from OP_TYPES so join gets its icon.
- Parallel-lane constraints: plan touches none of features/sources, DataSourceReferenceRepository, CommandBar, PanelGrid, useLayoutSave; no migration (notes V117 if ever).
- Inner/left exposure: determined by backend (SupportedJoinTypes = Vector("inner","left"); anything else throws at execute). Not a product decision; no escalation warranted. Unsupported stored types are surfaced honestly (D3).

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 3.10 does not itself list the AC6 live light+dark verification and screenshot persistence; the executor should do it (and run the e2e via start-servers.sh, not bare vite).
- PipelineStepRoutesSpec.scala ~217 comment says join is "picker-excluded"; update when touching nearby.
- "Standing Constraints" section in tasks.md is empty.
- Seam MCP check is a description string match; keep it anchored to exact keys so it isn't vacuous (include a negative mutation).
