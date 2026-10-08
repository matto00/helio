## Standing Constraints

## 1. Backend — validator

### Backend
- [x] 1.1 Add `OutputConfigValidation` (services/pipelines) with per-kind known keys, D3 tolerance, D4 hints, D5 aggregation/chartType rules; verify via task 4.1
- [x] 1.2 `OutputService.validateConfig` takes `(kind, written, stored)`, calls the validator first; `create` passes empty stored, `update` passes the patch + stored config (then still validates merged fieldMapping/compare/historyPayloads as today); verify `sbt testOnly` OutputService specs green
- [x] 1.3 `PatchSetPreviewProjection` passes patch + prior config; verify patch-set preview specs green
- [x] 1.4 `PipelineService.validateOutputFieldMapping` calls the validator with empty stored (single-call + proposal grounding); verify pipeline create/proposal specs green
- [x] 1.5 `OutputService.update` write-policy ADT `RestorePriorStored` (D9); `PatchSetApplyRollback` passes it; comment on `PatchSetUndoService` raw restore; verify task 4.4
- [x] 1.6 Remove `mergeableSubObjects` deep merge (shallow `mergeConfig`), fix OutputProtocol.scala/OutputService doc comments; update HEL-877 legend/tooltip tests and the HEL-946 chart-with-`legend` create fixture (OutputRoutesSpec ~L291-297) to the new contract — a contract change, not a test edited to pass

- [x] 1.7 `OutputConfigValidation.KeysDoc` (D11) into `AssistantProposalToolSchemas.PipelineProposalOutputSchema` config description, the `propose_patch_set` output-edit `patch` description, and `RefinementEditShape` Output-edit text; verify task 4.7

## 2. Frontend + contract docs

### Frontend
- [x] 2.1 `buildOutputConfig` chart branch: `aggregation: null` when chartType is scatter; fix `outputConfigTypes.ts` deep-merge comment; `OutputEditorSheet` shows the rejected server message (D7); verify buildOutputConfig + editor tests
- [x] 2.2 Update `schemas/outputs/create-output-request`, `update-output-request`, `schemas/pipelines/create-pipeline-transactional-output-request` per design D8 (no `additionalProperties:false` on config); verify schema/contract tests green
- [x] 2.3 helio-mcp: document per-kind keys + both aggregation shapes + 400 behaviour on add_output/update_output/create_pipeline/proposal tools and `apply_patch_set` output edits (refinement.ts); drop the legend/tooltip deep-merge text (incl. helioApi.ts ~L1126, types.ts ~L244); verify helio-mcp tests/build green

## 3. Spec hygiene
- [x] 3.1 `openspec validate validate-output-config-keys --type change` exits 0

## 4. Tests

### Tests
- [x] 4.1 Unit spec for `OutputConfigValidation`: every kind accepts its full known set; typo per kind rejected with hint; cross-kind key; legacy rename hints; unchanged-stored unknown key accepted; changed one rejected; every aggregation/chartType/scatter rule incl. both metric shapes, field conflict, stored-malformed-aggregation not re-validated, null-clears-stored-legacy-key; metric `{fieldMapping:{}, aggregation:null}` and `{fieldMapping:{label}}` accepted
- [x] 4.2 Route-level (OutputRoutesSpec or equivalent, real DB): 400 naming the key on POST and PATCH for each kind; nothing persisted; Output seeded with V94 legacy keys (direct repo/SQL insert) survives PATCH of `compare`, a full-config round-trip PATCH, a null clear (GET returns `"metricLabel": null`), and GET; explicit route-level 400 for a malformed chart aggregation
- [x] 4.3 Single-call create 400 + proposal grounding `validationError` naming an unknown key
- [x] 4.4 Patch-set forward+rollback: scatter chart with aggregation → bar → rollback restores scatter+aggregation (`rolledBack`) while a route PATCH of the same value is 400; and an Output carrying a legacy key
- [x] 4.5 Frontend: rendered-chart test proving a well-formed aggregation groups on the dashboard is already present (HEL-1351 ChartOutputPanel.aggregate.test.tsx) — cite it; add buildOutputConfig scatter test and an editor test that a 400 save shows the server message
- [x] 4.6 Mutation evidence: drop the validator call from each write path in turn and show the corresponding test red
- [x] 4.7 `AssistantProposalToolSchemasSpec` (proposal schema AND propose_patch_set patch description) + `RefinementEditShapeSpec` assert every kind's known keys and both aggregation shapes appear ON the output patch description itself (not just anywhere in the schema); helio-mcp test asserts apply_patch_set/update_output descriptions list keys
