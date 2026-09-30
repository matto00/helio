## Context

On main (e690399e): `OutputPanelConfig.controls` (V112, `OutputControlSpec{id,kind,column,label,defaultValue?}`); `PanelService.create/update` call `OutputControlsValidator.reject` (400 `control not eligible: column 'c', kind 'k'`, via `OutputControlEligibility.kindsFor`); `PATCH /api/panels/:id` `config.controls` is a whole-list replace (`OutputPanelConfig.Patch.controls: Option[Vector]`); `GET /api/outputs/:id/filter-capabilities` returns per-column `operators` only. helio-mcp: `update_panel` passes `config` through generically, `get_output_capabilities` is the pipeline-step shape tool (`/api/pipelines/:id/capabilities`), `get_dashboard` reads `/export`. Proposal apply already routes panels through `panelService.create`/`update`, so apply-time validation exists; propose-time (`DashboardProposalService.validate`, `CombinedProposalService.validate`) does not check controls.

Premise note: raw `update_panel({config:{controls:[...]}})` may already persist controls today; the red-first evidence must show what an agent can actually do (discoverability of eligible columns/kinds, id minting, no controls in context, no propose-time rejection) rather than assume impossibility.

## Decisions

**D1 Naming.** New tool `get_output_filter_capabilities`. The existing `get_output_capabilities` is untouched in name and behaviour; both descriptions gain one cross-reference sentence ("this is the step column SHAPE; for filter operators/control kinds use ..." and vice versa). The design gate must confirm the two descriptions cannot be confused, and a test asserts each description names the other tool.

**D2 Dedicated control tools, not `update_panel`/`place_outputs` overloads.** `update_panel`'s `config.controls` is a whole-list replace, easy to clobber and needs client-minted UUIDs; `place_outputs` is placement-only. Three narrow tools (`add_output_control`, `update_output_control`, `remove_output_control`) do read-modify-write over the panel's current `config.controls` (from `get_dashboard`'s export path) then PATCH `config: {controls}`. `update_panel` is left unchanged (still a valid raw escape hatch; its description points at the new tools). Race window between read and PATCH is accepted and documented (single-owner dashboards; last write wins, same as `update_panel`).

**D3 Eligibility has ONE source.** Extend each `filter-capabilities` column entry additively with `controlKinds: string[]`, computed by `OutputControlEligibility.kindsFor(column, operators, fieldType)` (the same function the validator uses). The MCP layer never reimplements eligibility; `add_output_control` with omitted `column` picks the first column in Output schema order whose `controlKinds` includes the kind (ordering rule only, mirroring the frontend's `firstEligibleColumn`), else errors client-side without a write, listing available kinds. Columns absent from `controlKinds`-bearing entries are ineligible. A supplied `column` is sent as-is and the server decides (defined 400). Update the JSON schema and the frontend TS type (optional field, no behavioural frontend change).

**D4 Ids.** MCP mints `crypto.randomUUID()` for a new control (HEL-1189 D2: ids are client-generated; server never mints). In proposals `id` is optional on a proposal control and `ProposalPanelSupport.buildCreateRequest` mints one at apply-build time (proposals already carry no ids and the apply layer mints panel ids).

**D5 Workspace context.** `WorkspaceContextOutputSummary.placements[]` gains `controls: {id,kind,column,label,orphaned?}[]` (defaultValue omitted to keep context small). Source: the panels' config from dashboard exports, one fetch per distinct dashboard hosting a placement (deduped), degrading to `controls: []` on failure like `fetchPlacements`; the fetch/call budget statement in `context.ts`'s header and its test are updated accordingly. Concise mode (HEL-865) keeps controls (small) and does not add an omitted-detail kind.

**D6 Proposal paths reuse the validator.** (a) `ProposalPanel` gains optional `controls: Vector[ProposalControl]` (output panels only; other types with `controls` are a validation error; supplying both `controls` and `config.controls` is a validation error). `buildCreateRequest` maps them into the derived config's `controls`. (b) `DashboardProposalService.validate` (propose and `PUT /dashboards/:id/contents`) after `preValidateBindings` calls the existing `OutputControlsValidator.reject` for every output panel with controls (existing controls empty), surfacing the validator's `ServiceError` unchanged (400) with the panel's position prefixed (message suffix identical). No new rule set. (c) Combined proposals: a panel bound to the `$pipelineOutput` sentinel has no Output yet, so its controls are validated by the same `panelService.create` at apply time (documented; explicit test of the apply-time defined error and of rollback behaviour as it exists today). Panels bound to an existing output id are validated at propose time as in (b). (d) Patch-set: edits' `panelPatch.config.controls` route through `panelService.update` at apply; where the patch-set preview/validate stage exists it calls the same validator (executor confirms the stage; if none exists beyond apply, the tool copy says errors surface at apply and a test proves the defined error and undo/rollback state). `propose_dashboard`/`apply_proposal`/`apply_patch_set` Zod schemas and descriptions gain the `controls` shape.

**D7 Status codes (HEL-1143).** Tool copy is written only after probing the live backend for: ineligible control (expected 400), unknown/not-owned panel or output (expected 404), non-output panel given controls, malformed control JSON, duplicate control id. Each documented code is asserted by a helio-mcp test that reads the code from a fixture captured from the live probe and recorded in evidence; nothing is copied from specs or prior tool copy.

**D8 Viewer visibility.** No frontend change intended: HEL-1190's viewer control bar renders `config.controls`. Verification is live in the browser after an MCP-only add, both themes; any UI defect found becomes an escalation/follow-up rather than silent scope growth.

## Risks / Trade-offs

- Additive `controlKinds` touches HEL-1188's response; mitigated as optional additive field with schema + backend test + frontend type.
- Combined-proposal controls on not-yet-existing outputs fail only at apply (documented limitation).
- Read-modify-write race on `controls` (D2).

## Migration Plan

None (no DB migration; V113 unused).
