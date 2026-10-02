## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Head reviewed: c24f52bb43ae48aede2b74e952aafe833b783b6e

### What I verified (with evidence)
- Own gate runs: `sbt --client testFull` -> "Tests: succeeded 5228, failed 0"; helio-mcp jest (src/tools) 26 suites/241 tests pass; `node scripts/check-schema-drift.mjs` passes (no form exception) and `check-schema-drift.selftest.mjs` all cases pass. No frontend changes -> UI judgment N/A.
- AC1: DashboardApplyProposalFormSpec "round-trip dataSourceId and submit a row end to end" (apply -> config.dataSourceId bound -> POST /submit -> dataset row count +1); also PUT contents and combined/patch-set specs; HEL-1071 layout check asserted in same test.
- AC2: rejection tests (unbound, config-only, foreign, nonexistent, csv/non-dataset, undeclared field, both bindings, dataSourceId on non-form) each assert 400 + message + no dashboard/panel created; validation is structural (ProposalPanelSupport.validateSourceBinding) plus DB-backed (preValidateBindings). Read the code: removing either check would flip these tests; evaluator's recorded mutation run (16 failures) is consistent with what I read.
- Wires: dashboard apply-proposal, PUT contents, combined proposal (source check runs BEFORE pipeline phase writes), patch-set create_panel (PatchSetApplyResolvers), assistant tool schemas (flat dataSourceId + decode-pinned example), MCP propose/apply (zod schema, handler, validation), JSON schemas all updated. NL authoring goes through DashboardProposalService.validate (shared) and its prompt does not offer `form` at all, so no unbound form can be produced there. MCP create_panel unchanged (already takes config.dataSourceId, PanelService path).
- Ownership/RLS: proposal path reuses FormBindingValidator (extracted verbatim from PanelService, which now delegates) using findByIdOwned; foreign and nonexistent ids give the identical "Data source not found" message (no oracle); dataset-kind and schema-consistency checks identical to direct create.
- FormPanelRoundTripSpec changes: legitimately changed, not weakened. Config-only binding is now rejected (new test), flat binding added as the positive case, cross-owner rejection retained (404 -> 400, same message, nothing created; disclosed in comments).
- Seam: shared-test-fixtures/form-proposal.json read by both formProposalSeam.test.ts (zod parse, real handler, real HelioApi/HelioHttpClient serialization toEqual fixture) and DashboardApplyProposalFormSeamSpec (posts it verbatim to the real route, submits). Genuine tie via one file; MCP half doesn't hit a live backend (stated and justified).
- AC4/drift derivation: agentFacingPanelTypes = canonical minus a reasoned exclusion table (lib/agentFacingPanelTypes.mjs); table is validated (reason required, no stale/bound kinds), binding fields parsed from Scala SourceBoundKinds/DataPanelKinds and required on proposal schema + MCP zod; selftest asserts the script has no form/divider-specific compare.

### Verdict: CONFIRM

### Non-blocking notes
- `divider` remains excluded by name in the table (with a stated, selftested reason) — a product-scope reason, acceptable under AC4's "stated, tested reason".
- Config-only `form` proposals that previously succeeded now 400; this is an intentional, documented behavior change.
- The cross-owner status changed 404 -> 400 on the proposal path (consistent with Output binding failures).
