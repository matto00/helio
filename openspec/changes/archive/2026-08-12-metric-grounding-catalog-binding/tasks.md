## 1. Backend (Scala) — proposal wire + validation

- [x] 1.1 Add `metricId: Option[String]` to `ProposalPanel` (`DashboardProposalProtocol.scala`) and to
      its hand-written `RootJsonFormat` `write`/`read` (mirror the existing `dataTypeId` lines exactly).
- [x] 1.2 Add `MetricIdSupportedKinds: Set[String] = Set("metric", "chart", "table")` to
      `DashboardProposalService`'s companion object, package-private, beside `DataPanelKinds`.
- [x] 1.3 `ProposalPanelSupport.preValidateBindings`: add a `metricRepo: MetricRepository` param; for
      each panel with `metricId` set, reject (400) before any create when the id doesn't resolve to a
      caller-owned metric, resolves to a `deprecated: true` metric, or the panel's `type` is outside
      `MetricIdSupportedKinds` — chained after the existing dataTypeId check, short-circuiting the same
      way.
- [x] 1.4 `ProposalPanelSupport.buildDataConfig`: splice `panel.metricId.map("metricId" -> JsString(_))`
      into `baseFields`.
- [x] 1.5 `DashboardProposalService`: add `metricRepo: MetricRepository` constructor param; pass it to
      `preValidateBindings`.
- [x] 1.6 `DashboardContentsService`: add `metricRepo: MetricRepository` constructor param; pass it to
      `preValidateBindings`.
- [x] 1.7 `ApiRoutes.scala`: wire `metricRepo` into both `new DashboardProposalService(...)` and
      `new DashboardContentsService(...)` construction sites (mirrors `panelService`'s existing
      `metricRepo` wiring one line above).
- [x] 1.8 No inline FQNs — import types at the top of each touched file per CONTRIBUTING.md.

## 2. Schema

- [x] 2.1 Add `metricId` (string, optional) to `ProposalPanel` in
      `schemas/dashboard-proposal.schema.json`, describing that it's additive to `dataTypeId` and
      supported only for `metric`/`chart`/`table` panels.

## 3. MCP Server (TypeScript) — grounding + proposal wire

- [x] 3.1 `helio-mcp/src/context.ts`: add `api.listMetrics()` to `buildWorkspaceContext`'s existing
      `Promise.all` fan-out; add a `metrics` array to `WorkspaceContext` with `id`, `name`, `dataTypeId`,
      `measureField`, `aggregation`, `allowedDimensions`, `format`, `deprecated` per entry.
- [x] 3.2 `helio-mcp/src/tools/read.ts`: update `get_workspace_context`'s tool description to mention
      the `metrics` field.
- [x] 3.3 `helio-mcp/src/tools/proposal.ts`: add `metricId: z.string().optional()` to `panelSchema`.
- [x] 3.4 `helio-mcp/src/types.ts`: add `metricId?: string` to `ProposalPanel`.
- [x] 3.5 `propose_dashboard`'s read-only check: fetch `api.listMetrics()`, build a `byId` map, and for
      any panel with `metricId` set, warn when missing/not-owned, warn when `deprecated`, warn when the
      panel's `type` is outside `metric`/`chart`/`table` — each warning excludes that panel from
      `applyReady`.
- [x] 3.6 `propose_dashboard`'s tool `description` string (`proposal.ts`): add a `metricId` bullet to the
      per-type field guidance (mirroring the existing `label`/`unit` bullet for `metric`) documenting
      that `metric`/`chart`/`table` panels may additionally supply `metricId` to bind to a defined
      metric, `dataTypeId` still required, and that it's unsupported on `collection`/`timeline` — this
      is the only place the calling agent reads per-field semantics (the zod schema itself carries no
      `.describe()`), so this bullet is what actually makes the new capability discoverable.

## 4. Tests

- [x] 4.1 `PanelServiceMetricBindingSpec.scala`-style coverage is unaffected (unchanged file); add new
      Scala coverage for `preValidateBindings`'s metricId path — reuse the
      `DashboardApplyProposal*Spec.scala` family's `ApplyProposalSpecBase` pattern: new
      `DashboardApplyProposalMetricBindingSpec.scala` covering valid/foreign/deprecated/
      unsupported-type `metricId` (both `apply-proposal` and `PUT /contents`).
- [x] 4.2 `DashboardProposalProtocolSpec.scala`: add `metricId` JSON round-trip coverage (present and
      absent-on-wire).
- [x] 4.3 `helio-mcp/src/context.test.ts`: add a `listMetrics` stub to `makeFakeApi()` and a
      `buildWorkspaceContext` assertion for the new `metrics` array (present, empty-workspace, and
      deprecated-metric-included cases).
- [x] 4.4 Create `helio-mcp/src/tools/proposal.test.ts` (none exists today): cover `propose_dashboard`'s
      metricId warning paths (missing/deprecated/unsupported-type/valid) and `applyReady` reflecting
      them.
- [x] 4.5 Run `sbt test` and helio-mcp's build + test suite; confirm no FQNs inlined
      (`grep`/lint per CONTRIBUTING.md).
