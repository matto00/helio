## 1. ### Backend — domain

- [x] 1.1 Add `PanelBindingSpec` in `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala`:
      one entry per bindable `PanelType` (`metric`, `chart`, `table`, `collection`, `timeline`) with
      required/optional slot names and a column-type eligibility function per slot, per design.md D2/D3.
- [x] 1.2 Add response protocol types (`PanelCapabilitiesResponse`, per-kind capability shape, column
      summary) in `backend/src/main/scala/com/helio/api/protocols/` + `JsonProtocols.scala` formatters.

## 2. ### Backend — service + route

- [x] 2.1 Add `PanelCapabilityService` (`backend/src/main/scala/com/helio/services/`): resolves the DataType
      via `dataTypeRepo.findByIdOwned` (404 on miss/cross-tenant, design.md D5), reads row count via
      `dataTypeRowRepo.listRows`, and evaluates `PanelBindingSpec` against the DataType's columns to build
      the per-kind bindability + eligible-columns response (design.md D3).
- [x] 2.2 Add `GET :id/panel-capabilities` under the existing `pathPrefix("types")` block in
      `DataTypeRoutes.scala` (design.md D6), calling `PanelCapabilityService`.
- [x] 2.3 Wire the route into `ApiRoutes.scala` (constructor wiring only — `DataTypeRoutes` already receives
      the new service dependency).

## 3. ### Backend — schema/spec contract

- [x] 3.1 Add `schemas/panel-capabilities-response.schema.json` describing the response shape.
- [x] 3.2 Update `openspec/` (OpenAPI) with the new endpoint + response schema reference. This repo has no
      standalone OpenAPI YAML file — `openspec/` is the spec-driven OpenSpec changes/specs tree. The
      capability contract is captured in this change's own
      `specs/panel-capability-introspection/spec.md` (already covers the endpoint's requirements/scenarios
      and gets folded into `openspec/specs/` at archive time, following every other change in this repo).

## 4. ### MCP surface

- [x] 4.1 Add `getPanelCapabilities` client method in `helio-mcp/src/helioApi.ts`.
- [x] 4.2 Register `get_panel_capabilities` read tool in `helio-mcp/src/tools/read.ts`, documented consistent
      with `bind_panel`'s slot-contract wording in `write.ts`.

## 5. ### Tests

- [x] 5.1 ScalaTest: numeric multi-row pipeline-output type → `chart`/`table`/`metric`/`collection`
      bindable with correct slots + eligible columns.
- [x] 5.2 ScalaTest: single-numeric-column multi-row type → `metric`/`collection` bindable (no row-count
      gate, HEL-292).
- [x] 5.3 ScalaTest: source-companion DataType (`sourceId` set) → all five kinds `bindable: false` with the
      V41 reason.
- [x] 5.4 ScalaTest: timestamp-bearing type → `timeline` bindable, timestamp column eligible for `time`.
- [x] 5.5 ScalaTest: cross-tenant request → 404, not 403 (design.md D5). Covered at both the service level
      (`PanelCapabilityServiceSpec`) and the route level (`DataTypeDataSourceAclSpec`, mirroring its
      existing `/rows`/`/validate-expression` ACL coverage).
- [x] 5.6 ScalaTest: `PanelBindingSpecSpec` cross-checks (a) `chart`'s slots minus `annotation` against
      `panelSlots.ts`'s `{xAxis,yAxis,series}`, (b) `timeline`'s slots against `{time,event}`, and (c)
      `collection`'s required/optional sets against `metric`'s (design.md D2) — literal transcribed
      constants, each commented with the frontend file:line it mirrors.
