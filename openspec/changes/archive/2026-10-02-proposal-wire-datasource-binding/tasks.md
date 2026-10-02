## 1. Prove current behavior (red first)

- [x] 1.1 Per wire (dashboard apply, contents replace, combined, patch-set create, MCP propose_*), write a test or probe showing today's behavior for a `form` panel with no binding and with `config.dataSourceId`; record outcomes in the report
- [x] 1.2 Write the AC2 rejection tests (missing, foreign-tenant, nonexistent, non-dataset source) and the AC1 end-to-end test; show them failing on the pre-fix code (commit order or run output as evidence)

## 2. Backend

- [x] 2.1 Add `dataSourceId` to `ProposalPanel` and its protocol; source-bound-kinds table; `validatePanel` rule; reject `dataSourceId` on non-source-bound kinds
- [x] 2.2 Extract the shared form-binding validator (ownership, dataset kind, schema consistency) from `PanelService`; add `dataSourceRepo` to `preValidateBindings` and update all callers/wiring (DashboardProposalService, DashboardContentsService, CombinedProposalService); reject flat `dataSourceId`+`outputId` on a form and `dataSourceId` on non-source-bound kinds
- [x] 2.3 `buildCreateRequest` threads authoritative `dataSourceId` into config; combined `validate` AND `apply` (before the pipeline write) run the form source check; test that no pipeline remains after a rejected combined form
- [x] 2.4 Patch-set `resolvePanelCreate`: for `type == form`, reject missing/empty `config.dataSourceId` and run the shared validator (patch-set-specific; not in shared `PanelService.create`); failing-first test
- [x] 2.5 Assistant proposal tool schemas updated and decode-pinned

## 3. Schemas, MCP, drift check

- [x] 3.1 Update `schemas/dashboards/dashboard-proposal.schema.json` (rewrite line-35 description that documents config-passthrough binding), `schemas/authoring/combined-proposal.schema.json`; deliberately update existing HEL-1083-era tests that assert a config-only form proposal succeeds
- [x] 3.2 helio-mcp: zod schemas, types, tool descriptions, proposalValidation warnings, tests
- [x] 3.3 Add `SourceBoundKinds` beside `DataPanelKinds`; derive `agentFacingPanelTypes` in `scripts/check-schema-drift.mjs` per design D6 (exclusion table with divider reason, binding-expressible assertions, fail-loud parse) with tests that fail on a stale/rebound exclusion; `npm run check:schemas` passes with no form exception

## 4. Seam + E2E

- [x] 4.1 Shared wire fixture consumed by BOTH MCP (node) and backend (Scala RouteTest) tests, with the backend spec asserting the fixture is accepted by the real apply route; plus a test driving the real MCP handler; any infeasibility of a live MCP-to-backend call is stated explicitly in the report
- [x] 4.2 Apply-then-submit end-to-end test (AC1), including valid layout with a form panel
- [x] 4.3 Record exact ids of any dev-DB rows created; clean by exact id

## 5. Gates

- [x] 5.1 `cd backend && nice -n 19 sbt testFull` (never bare `sbt test`), frontend lint/typecheck/test, helio-mcp tests, `npm run check:schemas`, openspec validate

## Standing Constraints

- [C1] Backend gate is `cd backend && nice -n 19 sbt testFull`; never bare `sbt test`; one full suite at a time; Bash calls run heavy work with `timeout: 600000` or background-and-poll in-turn.
- [C2] Dev DB cleanup by EXACT ids only (record ids as created); never by pattern/time window; never disable triggers/FKs.
- [C3] Known flakes not ours: HEL-1228 (1s RouteTest timeouts incl. FirstRunRoutesSpec) and HEL-1215 (PanelCard re-render count); report each occurrence with the test name.
- [C4] No production actions; test MCP behavior via helio-mcp tests/fresh process, never the session MCP client. Run `sbt --client shutdown` in the worktree before cleanup.
