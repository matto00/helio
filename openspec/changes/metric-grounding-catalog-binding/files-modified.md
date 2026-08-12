## Backend (Scala)

- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — added `metricId: Option[String]` to `ProposalPanel` and its hand-written `write`/`read` (absent-on-wire when `None`, mirroring `dataTypeId`).
- `backend/src/main/scala/com/helio/services/ProposalPanelSupport.scala` — `preValidateBindings` gained a `metricRepo` param and now chains a metricId check (rejects a missing/foreign/deprecated metric, or one set on a panel type outside `metric`/`chart`/`table`) after the existing dataTypeId check; `buildDataConfig` splices `metricId` into the created panel's config when present.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — added `metricRepo: MetricRepository` constructor param (threaded to `preValidateBindings`); added `MetricIdSupportedKinds = Set("metric", "chart", "table")` to the companion object.
- `backend/src/main/scala/com/helio/services/DashboardContentsService.scala` — added `metricRepo: MetricRepository` constructor param (threaded to `preValidateBindings`) so `PUT /api/dashboards/:id/contents` inherits the same metricId validation.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires the existing (nullable-optional) `metricRepo` into both `DashboardProposalService` and `DashboardContentsService` construction, mirroring `PanelService`'s existing convention.

## Backend tests (Scala)

- `backend/src/test/scala/com/helio/api/ApplyProposalSpecBase.scala` — wires a real `MetricRepository` into the shared `ApiRoutes` fixture; adds a `seedMetric` raw-SQL helper (mirrors `seedDashboardForOwner`) so dependent specs can seed a caller-owned/foreign/deprecated metric.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalMetricBindingSpec.scala` (new) — valid/nonexistent/foreign/deprecated/unsupported-type `metricId` coverage for both `POST /api/dashboards/apply-proposal` and `PUT /api/dashboards/:id/contents`, each rejection proven atomic.
- `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala` — added `metricId` JSON round-trip coverage (present/absent-on-wire) and a `metricId` param on the `panel()` test-fixture builder.

## Schema

- `schemas/dashboard-proposal.schema.json` — added optional `metricId` to `$defs.ProposalPanel`.

## MCP server (TypeScript)

- `helio-mcp/src/context.ts` — `buildWorkspaceContext` fans out `api.listMetrics()` alongside the existing `Promise.all` calls; `WorkspaceContext` gained a `metrics` array (id/name/dataTypeId/measureField/aggregation/allowedDimensions/format/deprecated per entry, never trimmed/paginated).
- `helio-mcp/src/tools/read.ts` — `get_workspace_context`'s tool description documents the new `metrics` field.
- `helio-mcp/src/tools/proposal.ts` — `panelSchema` gained an optional `metricId`; `propose_dashboard`'s read-only check now also fetches `api.listMetrics()` and delegates warning computation to `proposalValidation.ts`; tool description documents the new `metricId` capability per-type.
- `helio-mcp/src/tools/proposalValidation.ts` (new) — `computeProposalWarnings` extracted out of `proposal.ts` (pure, zod-free) so `propose_dashboard`'s dataTypeId/metricId warning logic can be unit-tested without pulling `proposal.ts`'s `server.registerTool(...)` + full `panelSchema` Zod surface into the ts-jest compile graph (root cause of a real TS2589 "type instantiation excessively deep" failure — see Root cause/Probe below). Also now the canonical location for `DATA_PANEL_TYPES`.
- `helio-mcp/src/types.ts` — `ProposalPanel` gained `metricId?: string`.

## MCP server tests (TypeScript)

- `helio-mcp/src/context.test.ts` — `makeFakeApi()` gained a `listMetrics` stub; new tests assert the `metrics` catalog (present/empty/deprecated-included); the two hand-built `WorkspaceContext` fixtures gained `metrics: []` (now a required field).
- `helio-mcp/src/tools/proposal.test.ts` (new) — first coverage of the `propose_dashboard` validation surface; tests `computeProposalWarnings` directly (missing/deprecated/unsupported-type/valid metricId, `applyReady` derivation, and independence from the pre-existing dataTypeId warning).

## Tooling

- `scripts/check-schema-drift.mjs` — updated the `DATA_PANEL_TYPES` panel-type-parity extraction to read from `helio-mcp/src/tools/proposalValidation.ts` (where the constant now lives) instead of `proposal.ts`.

## Environment (not part of the change; noted for the record)

- `helio-mcp/node_modules` was absent in this worktree (helio-mcp is a standalone project, not part of the root npm workspace) — ran `npm install` inside `helio-mcp/` to unblock any TypeScript compile/test of `helio-mcp/src/**`. No source change; a one-time local environment bootstrap.

## Root cause / probe (systematic-debugging.md — proposal.test.ts compile failure)

- **Root cause:** importing `proposal.ts` directly from a jest test pulls its two `server.registerTool(...)` calls — combined with `panelSchema`'s full Zod object type — into the ts-jest compile graph, which is TS2589 ("Type instantiation is excessively deep and possibly infinite") under this repo's root `tsconfig.json`/ts-jest configuration. Same class of issue already documented (and avoided) for `write.ts` in `write.test.ts`'s docstring.
- **Probe:** `npx jest --testPathPatterns=helio-mcp/src/tools/proposal.test.ts` with a first draft of `proposal.test.ts` that imported `registerProposalTools` from `./proposal.js`.
- **Probe output:** `error TS2589: Type instantiation is excessively deep and possibly infinite.` at both `server.registerTool(...)` call sites in `proposal.ts`.
- **Fix:** extracted the pure warning-computation logic into `proposalValidation.ts` (no zod, no `registerTool`); `proposal.ts` now calls it internally (behavior-preserving); `proposal.test.ts` imports only `proposalValidation.ts`. Re-ran the same command — passes (6 tests). Verified with fresh `npx jest --testPathPatterns=helio-mcp/src/tools/proposal.test.ts` after the fix.
