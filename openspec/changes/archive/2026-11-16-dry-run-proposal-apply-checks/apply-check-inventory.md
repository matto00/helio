# Apply-check inventory (Planning, fd7064f7d) -- every apply check vs propose

Abbrev: B = backend/src/main/scala/com/helio/; PPS = B services/pipelines/PipelineProposalService.scala; PCP =
PipelineCreatePreflight; PCT = PipelineCreateTransaction; PCW = PipelineCreateWrites; PPA = PipelineProposalAnalyze.
Cost: [pure] in-memory, [meta] DB metadata read, [net] live connector fetch, [row] row read. P = propose runs it.
Re-verify each row at D0; report any row that differs.

## 1. Pipeline proposal (propose: PPS.validate:89 = validateStructure:165 + root ownership:107)
| # | Apply check | Where | Cost | Propose today | Plan |
|---|---|---|---|---|---|
| 1.1 | validateStructure (name, roots, selectors, inline config shape, steps, ProposalStepRules, outputs) | PPS:132 | pure | P (same code) | unchanged |
| 1.2 | inline csv root -> 422 "inline csv sources are not supported by apply-proposal yet..." | PPS:360-365 | pure | A-only | D1.1 |
| 1.3 | existing sourceId ownership 404 | PPS:375 | meta | P | unchanged |
| 1.4 | inline sql: checkQuery, validateConfigShape, checkConfigEgress (400 Disallowed/Invalid) | SourceService.scala:80-110 | meta/DNS | egress A-only | D1.2 |
| 1.5 | inline rest: auth reject, connectorId xor url, toDomain, rejectBodyOnSafeMethod, checkConnectorKind, checkConnectorPending | SourceService.scala:115-250 | pure/meta | partly A-only | D1.2 |
| 1.6 | inline static: name, staticMaxRows, tag, column types, defaults, DatasetRowValidator | DataSourceService.scala:172-240 | pure | A-only | D1.2 |
| 1.7 | rest/sql fetch failure: source kept, empty schema; fails only if an Output has fieldMapping | PPS:434-445, 533-551 | net | n/a | D1 fetch-failure rule |
| 1.8 | checkRootsReadOnly: rootShapeProblem + ownership | PCW:74,93,116 | meta | overlaps P | covered by D1.4 |
| 1.9 | PipelineCreatePreflight.run: root index resolution, laneChecks, checkStep, checkOutput + validateOutputConfig | PCP:31-227 | pure | partly A-only | D1.4 |
| 1.10 | validateStepCrossOwnerRefs: secondary-source ownership 404, upsert target NotFound/NotWritable | PCT:106-140 | meta | A-only | D1.5 |
| 1.11 | PipelineCycleGuard.checkExistingGraphAction; upsertsource step cycle check on insert | PipelineRepository.scala:452-483; PipelineStepRepository.scala:47-93 | meta | A-only | D1.6 (or stated apply-only) |
| 1.12 | Output fieldMapping slot + column-at-node (OutputFieldMappingCheck) | PCT:214-258 | pure over meta | A-only (analyze: 200 validationError) | D1.7 |
| 1.13 | the run (submit isDry=false); blocked/failed -> rollback, 422 | PPS:553-566 | row/net | A-only | NOT dry-runnable (non-goal) |
Note: a REST root with only `newConnector` passes validate but fails analyze/apply ("Missing required fields") --
D1.2 (createRest's checks) closes it; confirm at D0.

## 2. Combined (propose: CombinedProposalService.validate:50)
| Apply check | Where | Propose today | Plan |
|---|---|---|---|
| everything in section 1 | | A-only | via D1 |
| resolveSentinelOutputId count (exactly 1 Output if sentinel used) 422 | :155-168 | A-only, statically knowable | D2 |
| ProposalLayoutSupport.validate | DashboardProposalService:117 | A-only | D2 |
| preValidateBindings for non-sentinel panels | ProposalPanelSupport:154,217-230 | A-only | D2 |
| controls for sentinel-bound panels | ProposalPanelSupport:125-146 | A-only | D2 (or stated apply-only) |
| PanelService.create checks | section 3 | A-only | D3 |
(No panel-kind vs Output-kind compatibility check exists anywhere.)

## 3. Dashboard (propose: DashboardProposalService.validate:62 == apply's first step)
A-only: PanelCreateBuilder.buildForCreate (PanelCreateBuilder.scala:34-79): PanelConfigCodec.decodeCreateConfig,
rejectMissingOutput (404, vs validate's 400 for same condition), panel.validateConfig, controls, form. DashboardService
.update LayoutPolicy on combined/reflowed layout (valid by construction; not analyzed). Plan: D3.

## 4. Patch set (preview and apply share PatchSetApplyResolvers.resolveAll)
Output-create column check already in resolveAll (HEL-1639). A-only: proposalId UUID, stale fingerprint, $ref
substitution (apply mechanics, not input checks); PanelService.create (output exists, validateConfig, controls) and
PanelService.update (PanelUpdateValidation) -> D3. PipelineService.create edit (rows 1.4-1.12 as applicable, inline
roots via PipelineRootWrites.resolveOneRootSourceId's inline-branch checks and messages) -> IN SCOPE via D1b. Follow-up
ticket ONLY for: addStep placement/lane/cycle (PipelineStepCreate.scala:78,108,142), updateStep,
DataSourceService.createStatic/update.

## 5. Entry points
Assistant: AssistantToolExecutor propose_dashboard/pipeline/combined/patch_set -> validate/preview; Left -> isError.
HTTP: no validate route for pipeline/combined/dashboard; apply routes /api/pipelines/apply-proposal,
/api/proposals/apply, /api/dashboards/apply-proposal; /api/patch-sets/preview|apply; /api/pipelines/analyze-proposal.
helio-mcp: propose_pipeline (pipelineProposalHandlers.ts:36-60) and propose_dashboard (proposal.ts/proposalHandlers.ts)
do client-side warnings only; analyze_pipeline_proposal -> analyze route; propose_patch_set -> /api/refinements
(preview). No MCP propose_combined.

## 6. Test homes
PipelineProposalServiceValidateSpec, CombinedProposalServiceValidateSpec, AssistantToolExecutorSpec (+
AssistantServiceSpec for isError, testsupport/AssistantStandingsFixture), PipelineApplyProposalSpec(+Base),
CombinedApplyProposalSpec(+Base), DashboardApplyProposal*Spec, PatchSetOutputCreateSpec, PatchSetPreviewServiceSpec,
helio-mcp src/tools/pipelineProposalHandlers.test.ts, proposal.test.ts.

## D0 corrections (executor, verified against code at fd7064f7d)
Verified directly: 1.2 (PPS inline csv 422 message, now the shared `inlineCsvRejection`), 1.3, 1.9 (PCP.run/checkOutput), 1.10 (PCT.validateStepCrossOwnerRefs), 1.12 (OutputFieldMappingCheck via PCT.buildOutputsAction), section 2 (combined validate skipped layout and sentinel count; confirmed by red tests) and the disabled-step gap (PCT omitted `enabled` in NodeStepInput; NodeStepInput.enabled defaults true).
Re-verified in slice 2 (executor, same commit base): 1.4-1.6, section 3, section 4 (differences below). 1.11 line numbers were not re-checked (apply-only per 0.2, unchanged).
Corrections found: (a) `validate` previously accepted inline csv roots; apply 422s. Now both reject (an existing AssistantToolExecutorSpec test that expected Right was updated; it still proves the test_connection gate is bypassed by asserting apply's csv message). (b) The CombinedProposalServiceValidateSpec fixture used a sentinel panel with a zero-Output pipeline; apply 422s that, so the fixture now carries one Output.

## Task 0.2 decisions
- D1.6 cycle guards: APPLY-ONLY. `PipelineCycleGuard.checkExistingGraphAction(...)` takes `Set.empty` and checks the already-persisted graph, independent of the proposal (nothing to dry-run), and takes an advisory lock inside a DBIO; the new pipeline's own roots+upsertsource cycle check lives in `PipelineStepRepository.insertInternalAction` and needs persisted ids. Not faked.
- D2 sentinel-controls: APPLY-ONLY. `OutputControlsValidator` has `require(outputRepo != null)` and reads a persisted Output (kind/config/node schema); no persisted Output exists at propose time. Sentinel panels still get the static count check.

## Status of rows after slice 1 (SUPERSEDED by "Final classification (task 6.2)" at the end of this file; kept as history)
Dry-run now: 1.2, 1.3, 1.8/1.9 (preflight), 1.10, 1.12 (existing-source and inline static roots; inline static via shared `DataSourceService.validateStatic`, apply's runtime column types), combined sentinel count + layout.
Not yet dry-run: 1.4, 1.5, 1.7 (inline rest/sql: root schema unknown, Outputs descending from such a root are skipped by the column check), 1.13 (non-goal), patch-set pipeline create (D1b), panels (D3), routes/MCP (D4).

Follow-up for patch-set step add/update and data-source edit checks: HEL-1722.

### D0 corrections, slice 2 (rows 1.4-1.6, sections 3 and 4)
- 1.4 (createSql): confirmed `checkQuery`, `validateConfigShape`, `checkConfigEgress(failOnUnresolvable = false)`, in that order, all `BadRequest`; now `SourceService.validateSqlCreate`, called by `createSql` and by the dry run.
- 1.5 (createRest): DIFFERENCE. The inventory lists `toDomain`, `checkConnectorKind` and `checkConnectorPending` as run for every inline REST root. They run ONLY on the `connectorId` branch. The bare-`url` branch runs: `type == rest_api`, no `auth`, `connectorRepo != null`, then `rejectBodyOnSafeMethod` on the raw payload (before the Auto connector is persisted); no kind/pending check (the connector is synthesized). Also confirmed: a bare-`url` request builds its config by `splitUrl` + merge of the URL's own query pairs with `queryParams` + `parameters` (HEL-844/HEL-983). Now `SourceService.validateRestCreate` (returns a `RestCreatePlan`), called by `createRest` and by the dry run.
- 1.6 (createStatic): confirmed in slice 1 (`DataSourceService.validateStatic`).
- Section 3: `PanelCreateBuilder.buildForCreate` order confirmed (`resolveCreateConfig`, `resolveCreateAppearance`, `rejectMissingOutput`, `rejectMissingDataSource`, `panel.validateConfig`, `OutputControlsValidator.reject`, `rejectInconsistentForm`). Task 1.4 red: a `form` panel whose config has a duplicate `sourceField` passes `DashboardProposalService.validate` (evidence/red-1.4.txt). DIFFERENCE for D3: the dashboard-proposal `ProposalPanel` cannot carry a divider `weight` (only `orientation`), so the divider `weight <= 0` rule is not reachable from a dashboard proposal; the reachable `validateConfig` rejections are form (`FormPanel`) and output `controls` (`OutputControlSpec.validateList`, already covered by `validateControlsShape`/`preValidateControls`). Patch-set panel create carries a full config, so divider weight is reachable there (task 3.3).
- Section 4: unchanged from the inventory.
- New behaviour fact: apply now fetches an inline rest/sql root's schema twice (dry run, then create), so a fixture that counts fetch calls (`PipelineApplyProposalSpecBase.RestRunFailUrl`) shifts its "run-time" failure from the 2nd call to the 3rd. This is the design's stated double-fetch risk, not a defect.

## Slice B (tasks 2.2-2.6)
- 2.2/2.3: `createTransactional`/`buildOutputsAction` call `PipelineOutputSchemas` (outputNodeSchemas, outputMappingProblem); the dry run is `PipelineCreateDryRun` (preflight, checkOutputs, check), not renamed to `PipelineProposalDryRun` because it is shared by the proposal path (`PipelineProposalService.dryRun`, run by validate AND apply) and the patch-set resolver. Root schemas come from the shared `PipelineRootDryRun` (existing/static/sql/rest/csv).
- 2.4: inline static root schema is `DataSourceService.validateStatic(...).fields` (apply's runtime column types), via `PipelineRootDryRun`.
- 2.5 (D1b): inline root shape checks live once in `PipelineRootWrites.shapeProblem`/`inlineShapeProblem` (called by `resolveInlineRootSourceId`, `PipelineCreateWrites.rootShapeProblem` and the resolver). `PatchSetPipelineResolvers.resolvePipelineCreate` (resolveAll, so preview AND apply) runs, in checkedCreate order: root shape + existing ownership, preflight + cross-owner refs, root schemas (inline create checks, budgeted live fetch), Output column check; errors get `edit N:`. C12 charging: PREVIEW charges the source-fetch budget (`PatchSetApplyContext.chargeFetches = true`); apply's resolve does not, mirroring `PipelineProposalService.apply` (the preview that preceded it paid), and apply's single fetch is the one `createRest`/`createSql` already make. `PatchSetPreviewService` takes `sourceService`/`sourceFetchBudget` (ApiRoutes shares the proposal budget); `PatchSetApplyService` takes `sourceService`. With no SourceService wired an inline rest/sql root fails like apply's own "unavailable" guard.
- 2.6: DisabledStepOutputColumnRoutesSpec (POST /api/pipelines); red with `enabled = true` restored in `nodeInputs`: evidence/red-2.6-disabled-step.txt.

## Slice B (tasks 3.1-3.3)
- 3.2: `PanelCreateBuilder.buildForCreate` now delegates to one `run` made of pure parts (`resolveCreate`, `constructPanel` incl. `panel.validateConfig`) and binding parts, order unchanged; `dryRunForCreate(.., Binding.Real | Binding.Sentinel)`. `Sentinel` is a case object (not `Sentinel(proposedOutput)`): per the 0.2 decision a sentinel panel's controls are apply-only, so no proposed Output is needed. Sentinel skips `rejectMissingOutput` and the controls check; data-source existence, `validateConfig` and form consistency still run. Facade `PanelCreateDryRun` (placeholder dashboard id). `DashboardProposalService.validate` runs it per panel (Real) after the existing binding/controls checks (red-1.4 test landed).
- 3.1: combined validate runs `dryRunPanels` with `panelReferencesSentinel` selecting Sentinel (sentinel panels) vs Real (everything else, which also still gets `preValidateBindings`/controls as before).
- 3.3: `PatchSetPanelResolvers.resolvePanelCreate` runs the dry run (Real for a non-`$ref` outputId, Sentinel for `$ref`); `resolvePanelUpdate` runs `PanelUpdateValidation` (via `PanelCreateDryRun.checkUpdate`) on the effective config. Errors get `edit N:`. Finding: apply's panel UPDATE does not call `panel.validateConfig` (only decode, binding existence, controls, form consistency), so an update with divider weight 0 is accepted by apply and therefore by preview (parity, not a gap). The patch-set controls validator has no node-snapshot repo, so a `dropdown` control's eq/in cardinality check remains apply-only (apply is stricter, never looser). Existing PatchSetApplyServiceSpec HEL-1193 test now sees the control rejection at resolve (a 400 before any edit applies) instead of as a mid-set failure; updated accordingly. Red evidence: evidence/red-3.3-patchset-panels.txt.

## Final classification (task 6.2)
Every apply check is either dry-run (shared function, so propose and apply run the SAME code) or apply-only with the reason.
Paths are under backend/src/main/scala/com/helio/.

| Row | Status | Shared function / reason |
|---|---|---|
| 1.1 validateStructure | dry-run | `PipelineProposalService.validateStructure` (same code both sides) |
| 1.2 inline csv 422 | dry-run | `PipelineProposalService.inlineCsvRejection` (via `PipelineRootDryRun.rootSchema`) |
| 1.3 existing-source ownership | dry-run | `PipelineProposalService.validateSourceReference` |
| 1.4 inline sql checks | dry-run | `services/sources/SourceService.validateSqlCreate`, called by `createSql` and `PipelineRootDryRun` |
| 1.5 inline rest checks | dry-run | `services/sources/SourceService.validateRestCreate` (+ one request composition) |
| 1.6 inline static checks | dry-run | `services/sources/DataSourceService.validateStatic` |
| 1.7 rest/sql fetch failure rule | dry-run | `PipelineProposalService.dryRunRootSchema`; fetch charged to `SourceFetchBudget` (C12), issued via `issueAndParse` (C11) |
| 1.8/1.9 root shape, preflight (lanes, steps, output config) | dry-run | `PipelineRootWrites.shapeProblem`, `PipelineCreatePreflight.run`, via `PipelineCreateDryRun` |
| 1.10 cross-owner refs (secondary sources, upsert target) | dry-run | `PipelineCreateTransaction.validateStepCrossOwnerRefs` via `PipelineCreateDryRun` |
| 1.11 cycle guards | apply-only | Reads/locks the persisted graph (`PipelineCycleGuard.checkExistingGraphAction`, `PipelineStepRepository.insertInternalAction`); a not-yet-persisted pipeline has nothing to check against (task 0.2) |
| 1.12 Output fieldMapping column check | dry-run | `services/pipelines/PipelineOutputSchemas.outputNodeSchemas` / `outputMappingProblem` (mutation proof in evidence) |
| 1.13 the run | apply-only | Reads rows / calls connectors; explicit non-goal |
| 2 combined: sentinel count, layout, non-sentinel bindings, panel checks | dry-run | `CombinedProposalService.validate` calling `resolveSentinelOutputId`, `ProposalLayoutSupport.validate`, `DashboardProposalService.dryRunPanels` |
| 2 sentinel-panel controls | apply-only | `OutputControlsValidator` needs a persisted Output (task 0.2) |
| 3 dashboard panel create | dry-run | `services/panels/PanelCreateBuilder.dryRunForCreate` (Real/Sentinel), facade `PanelCreateDryRun`; `DashboardProposalService.dryRunPanels` |
| 3 DashboardService.update LayoutPolicy | apply-only | Valid by construction on the combined/reflowed layout |
| 4 patch-set pipeline create | dry-run, except a create with roots but no steps or Outputs (inline root create checks then run at apply only; HEL-1722) | `PatchSetPipelineResolvers.resolvePipelineCreate` (preview and apply both go through `resolveAll`) |
| 4 patch-set panel create / update | dry-run | `PatchSetPanelResolvers.resolvePanelCreate` / `resolvePanelUpdate` (`PanelCreateDryRun.checkUpdate`) |
| 4 dropdown control cardinality (eq/in) | apply-only | Patch-set controls validator has no node-snapshot repo; apply is stricter, never looser |
| 4 proposalId UUID, stale fingerprint, `$ref` substitution | apply-only | Apply mechanics, not input checks |
| 4 addStep placement/lane/cycle, updateStep, DataSourceService.createStatic/update | apply-only (deferred) | Follow-up HEL-1722 |
| 5 entry points | done | Assistant `validate`/`preview` now include the dry run; HTTP `POST /api/pipelines/validate-proposal`, `/api/dashboards/validate-proposal`, `/api/proposals/validate` (no own rate-limit directive: the fetch is charged once, inside validate, to the shared source-fetch limiter); helio-mcp `propose_pipeline`/`propose_dashboard` call them (`HelioApi.validatePipelineProposal`/`validateDashboardProposal`) |
