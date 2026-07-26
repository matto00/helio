# Files modified — panel-capability-introspection (HEL-365)

## Backend — new files

- `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala` — canonical slot contract
  (`requiredSlots`/`optionalSlots`/`columnEligibility`) per data-bindable `PanelType`, design.md D2/D3.
- `backend/src/main/scala/com/helio/api/protocols/PanelCapabilityProtocol.scala` — `PanelCapabilitiesResponse`
  / `PanelCapabilityResponse` / `PanelCapabilityColumnResponse` wire types + spray-json formatters.
- `backend/src/main/scala/com/helio/services/PanelCapabilityService.scala` — resolves the DataType
  owner-scoped (`findByIdOwned`), builds the per-kind bindability/eligible-columns/shape-signal response.

## Backend — modified files

- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `PanelCapabilityProtocol`.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — adds `GET :id/panel-capabilities`
  under the existing `pathPrefix("types")` block (design.md D6); constructor now also takes
  `PanelCapabilityService`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — instantiates `PanelCapabilityService` and passes
  it into `DataTypeRoutes`.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/panels/PanelBindingSpecSpec.scala` — cross-checks slot sets
  against the frontend contract (task 5.6).
- `backend/src/test/scala/com/helio/services/PanelCapabilityServiceSpec.scala` — tasks 5.1-5.5 (numeric
  multi-row, single-numeric-column many-row, companion/V41, timestamp/timeline, cross-tenant 404).
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` — updated `DataTypeRoutes`
  construction call site for the new constructor param.
- `backend/src/test/scala/com/helio/api/routes/DataTypeDataSourceAclSpec.scala` — updated construction call
  site + added a route-level cross-tenant 404 test for `GET /types/:id/panel-capabilities`.

## Contract

- `schemas/panel-capabilities-response.schema.json` — new response schema (title
  `PanelCapabilitiesResponse`, matches the new case class 1:1 per `check-schema-drift.mjs`).
- `openspec/changes/panel-capability-introspection/tasks.md` — checkboxes updated as tasks completed.

## MCP surface

- `helio-mcp/src/types.ts` — `PanelCapabilityColumnResponse` / `PanelCapabilityResponse` /
  `PanelCapabilitiesResponse` TS mirrors.
- `helio-mcp/src/helioApi.ts` — `getPanelCapabilities(dataTypeId)` client method.
- `helio-mcp/src/tools/read.ts` — registers the `get_panel_capabilities` read tool.
- `helio-mcp/README.md` — adds `get_panel_capabilities` to the tool catalog table.
