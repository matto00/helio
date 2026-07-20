## 1. Backend — proposal contract

- [x] 1.1 Add optional `config: Option[JsObject]` to `ProposalPanel` case class (`DashboardProposalProtocol.scala`)
- [x] 1.2 Read/write `config` in the custom `proposalPanelFormat` (tolerant of absent field)
- [x] 1.3 In `DashboardProposalService.buildCreateRequest`, merge `config` over the derived flat config (derived ++ config), keeping flat `dataTypeId` authoritative after merge (D2)
- [x] 1.4 Ensure the merge yields a valid `CreatePanelRequest` in both shapes: data panels (base always has flat `dataTypeId`, `config` augments) and non-data panels that supply only `config` (empty base, `config` alone forms the payload); do not loosen the `DataPanelKinds` dataTypeId requirement (D3)

## 2. Schema

- [x] 2.1 Add `config` object property to `ProposalPanel` in `schemas/dashboard-proposal.schema.json` (additive, optional)
- [x] 2.2 Remove `divider` from the `ProposalPanel.type` enum in the schema

## 3. MCP client

- [x] 3.1 Add `config?: Record<string, unknown>` to `ProposalPanel` in `helio-mcp/src/types.ts`
- [x] 3.2 Add `config` to the zod `panelSchema` and drop `divider` from `PANEL_TYPES` in `helio-mcp/src/tools/proposal.ts`
- [x] 3.3 Refresh `propose_dashboard`/`apply_proposal` tool descriptions with the `config` passthrough + per-type v1.5 shapes; remove stale `divider` guidance

## 4. Tests

- [x] 4.1 Backend: proposal with a collection `config: {baseType, layout}` creates a collection panel with those options
- [x] 4.2 Backend: proposal with a chart `config: {chartOptions}` persists chart options; table `config: {density, columnOrder}` persists table config
- [x] 4.3 Backend: `config` cannot override `dataTypeId` to bypass the V41 pipeline-only binding rule
- [x] 4.4 Backend: flat-field-only proposal (no `config`) produces unchanged output (regression)
- [x] 4.5 MCP: build `dist`; assert `PANEL_TYPES` has no `divider` and the panel schema accepts `config`

## 5. Verification

- [x] 5.1 Run `openspec validate --change mcp-proposal-panel-parity`, `sbt test`, MCP lint/build
- [ ] 5.2 End-to-end: mint a PAT, `apply_proposal` a collection + a chart with `chartOptions` against the live backend (evaluator — requires a running backend + dev server; out of executor scope per orchestrator brief)
- [ ] 5.3 Verify the in-app Proposal Review UI still round-trips a proposal (shared write path, no regression) (evaluator — requires the dev server UI check)

## 6. Round-2 fixes (skeptic-refuted V41 gap — see skeptic-final-1.md)

- [x] 6.1 Extend `PanelServiceHelpers.dataTypeIdFromCreateConfig` to also extract `dataTypeId` for `TextCreate`/`MarkdownCreate`, so `PanelService.create`'s `rejectCompanionBinding` covers text/markdown on every create path (direct `POST /api/panels`, `create_panel`, `apply_proposal`) — root-cause fix, closes CR4 too
- [x] 6.2 Extend `DashboardProposalService.preValidateBindings` (via a new `bindingCandidate`/`nonFlatConfigDataTypeId` helper) to inspect `config.dataTypeId` for non-`DataPanelKinds` panels, so the proposal's up-front atomicity guarantee covers text/markdown bindings too
- [x] 6.3 Regression tests: text + markdown panel binding a source-companion DataType via `config.dataTypeId` → 400, create nothing (`DashboardApplyProposalSpec`); text + markdown binding a VALID pipeline-output DataType via `config.dataTypeId` → succeeds (`DashboardApplyProposalSpec`); direct `PanelService.create` text-panel companion-binding test (`PanelServiceCompanionBindingGuardSpec`)
- [x] 6.4 Correct the now-inaccurate absolute "config can never bypass V41" / "dataTypeId always stays authoritative" claims in `design.md` (D2/D3, new D3a), `DashboardProposalService.scala` doc comments, `schemas/dashboard-proposal.schema.json`'s `config` description, and `helio-mcp/src/tools/proposal.ts` + `helio-mcp/src/types.ts` doc comments — now accurately scoped to `DataPanelKinds` vs. text/markdown's separately-validated `config.dataTypeId`
- [x] 6.5 Live re-probe: restarted the worktree backend with the fixed code and re-ran the skeptic's exact curl (companion `dataTypeId` via `config` on a `text` panel) → now 400; the identical request against a valid pipeline-output DataType → 201; metric-panel companion-bypass-via-config sanity re-check → still 400 (no regression)
