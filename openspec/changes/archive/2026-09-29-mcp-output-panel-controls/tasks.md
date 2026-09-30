## 0. Red first
- [x] 0.1 On unmodified main, via helio-mcp only, attempt to add a date-range control to an existing output panel; record exactly what is impossible/undiscoverable (no filter-capability read, no eligible-column info, no controls in `get_workspace_context`, `propose_dashboard` accepting an ineligible control at propose time). Persist as evidence.
- [x] 0.2 Probe the live backend status codes listed in design D7; persist the transcript.

## 1. Backend
- [x] 1.1 Add `controlKinds` to each filter-capabilities column entry via `OutputControlEligibility.kindsFor`; update protocol, `schemas/outputs/output-filter-capabilities-response.schema.json`, backend tests, frontend response TS type.
- [x] 1.2 Add `ProposalControl`/`controls` to `ProposalPanel` (protocol format, `schemas/dashboards/dashboard-proposal.schema.json`), mapping in `ProposalPanelSupport.buildCreateRequest` (mint id when absent), structural checks (output-only, no dual `controls`+`config.controls`).
- [x] 1.3 `DashboardProposalService.validate` (+ `PUT contents`) runs `OutputControlsValidator.reject`; combined and patch-set paths per design D6; backend tests incl. defined 400 message parity with the panel write path.

## 2. helio-mcp
- [x] 2.1 `get_output_filter_capabilities` + `helioApi`/types; cross-reference copy on `get_output_capabilities`; tests incl. description-disambiguation test.
- [x] 2.2 `add_output_control` / `update_output_control` / `remove_output_control` (+ handlers, Zod, tests: auto-bind, explicit column, ineligible -> unchanged 400, not-an-output-panel, unknown id, no write on client-side failure).
- [x] 2.3 `get_workspace_context` placements list controls; update header call-budget note + `context.test.ts`.
- [x] 2.4 `propose_dashboard`/`apply_proposal`/combined/patch-set Zod schemas + descriptions expose `controls`; `server.test.ts` tool list updated.
- [x] 2.5 Tool copy status codes taken from 0.2 evidence; tests assert them.

## 3. Verification
- [x] 3.1 Gates: backend `sbt test` (targeted + full), helio-mcp tests/lint/typecheck, frontend typecheck/lint/jest for the touched type, node-root guard if `NodeSnapshotRepository` is touched.
- [x] 3.2 Live E2E: MCP-only add of a date-range control to an existing output panel on this worktree's servers; open the dashboard in the browser in light and dark themes and confirm the viewer control bar shows it; screenshots outside repo root.
- [x] 3.3 Record any flake verbatim in evidence.

## Standing Constraints
- [C1] Red-first: evidence must show MCP-only control add lacking on main before the fix; guards must be mutation-failable.
- [C2] Tool-copy status codes come from live-backend probes, never from specs/prior copy (HEL-1143).
- [C3] Every Bash call that can run hooks/sbt/jest/CI passes timeout 600000; max 3 workers under nice -n 19; screenshots never at repo root; verify dev servers serve THIS worktree via readlink /proc/<pid>/cwd.
- [C4] Any code/test commit after a final CONFIRM requires a fresh final verdict; branch updates from main must leave verdict head_shas acceptable to check-merge-readiness.sh.
- [C5] Driver statements are claims to verify; record any flake test name + message verbatim in evidence.
- [C6] (design-gate notes) Control validation lives in shared `ProposalPanelSupport` so BOTH `DashboardProposalService.validate` and `DashboardContentsService` (PUT contents) are covered; wire `NodeSnapshotRepository` into those services + fixtures. Patch-set: no second rule set in the preview projection; errors surface at apply via `panelService.update`, copy + test say so. Enumerate proposal-shape sites: `frontend/src/features/dashboards/types/proposal.ts`, helio-mcp `types.ts`/`proposalValidation.ts`, `AssistantProposalToolSchemas.scala`, `DashboardAuthoringPrompt.scala`. Probe duplicate-id and non-output-panel behavior; do not assume 400.
