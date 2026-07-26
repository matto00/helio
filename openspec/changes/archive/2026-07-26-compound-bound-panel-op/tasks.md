## 1. Backend: wire types + shared bindability helper

- [x] 1.1 Add `BoundPanelRequest`/`BoundPanelResponse` (+ nested `BoundSourceSpec`,
      `BoundPipelineSpec`, `BoundPanelSpec`) wire types to `backend/src/main/scala/com/helio/api/protocols/`
      and their `JsonProtocols.scala` formatters, matching design.md D2's shape exactly.
- [x] 1.2 Extract the bindability computation currently inline in
      `PanelCapabilityService.capabilityFor`/`eligibleColumnNames` into a pure, reusable function
      (e.g. `PanelBindingSpec.evaluate(spec, columns): BindabilityResult`) — behavior-preserving;
      `PanelCapabilityService` calls through to it, no test change expected there.

## 2. Backend: BoundPanelService

- [x] 2.1 Create `backend/src/main/scala/com/helio/services/BoundPanelService.scala`, composing
      `DataSourceService`, `PipelineService`, `PipelineRunService`, `PanelService`, `DataTypeRepository`,
      `DataTypeRowRepository`, `AccessChecker` (constructor DI, same pattern as `DashboardContentsService`).
      (Also takes `DataSourceRepository` and `PanelRepository` directly — the former for the owner-scoped
      `sourceDataSourceId` re-verify design.md D4 calls out by name, the latter to actually persist the
      panel `PanelService.buildForCreate` only builds — same repo+service DI shape
      `DashboardContentsService` itself uses with `dashboardRepo`+`panelService`.)
- [x] 2.2 Implement the validate-before-first-write gate (design.md D3): exactly-one-of
      source/sourceDataSourceId, dashboard ACL (editor/owner), `panel.type` in
      `PanelBindingSpec.DataBindable`, source-schema resolution (inline columns, or read-only lookup of
      an existing `sourceDataSourceId`'s companion DataType), `PipelineAnalyzeService.analyze` projection,
      and the `PanelBindingSpec.evaluate` check from 1.2 — zero writes anywhere in this method.
- [x] 2.3 Implement the execution chain (design.md D4): create-or-reuse source → `pipelineService.create`
      → `pipelineService.addStep` per step → `pipelineRunService.submit(isDry = false)` → build+insert
      panel via `panelService.buildForCreate`, injecting `{dataTypeId, fieldMapping}` into `panel.config`.
- [x] 2.4 Implement compensating cleanup (design.md D5) as a private helper invoked from every failure
      branch of 2.3, in the exact order specified (rows → output DataType → companion DataType + source,
      only for an inline-created source) — swallow/log cleanup failures, never mask the original error.
- [x] 2.5 Map each failure branch to a `4xx`/`5xx` `ServiceError` naming its stage
      (`"source"|"pipeline"|"steps"|"run"|"panel"`), following the HEL-311 curated-message discipline
      (never echo a raw exception).

## 3. Backend: route + wiring

- [x] 3.1 Create `backend/src/main/scala/com/helio/api/routes/BoundPanelRoutes.scala` — thin shell,
      `POST /api/panels/bound`, no business logic (mirrors `DashboardContentsRoutes`/`PanelRoutes`).
- [x] 3.2 Wire `boundPanelService`/`BoundPanelRoutes` into `ApiRoutes.scala`, constructed after
      `dataSourceService`/`pipelineService`/`pipelineRunService`/`panelService`, mounted in the
      authenticated route tree.

## 4. Schemas + OpenSpec contract

- [x] 4.1 Add the `POST /api/panels/bound` request/response JSON Schema under `schemas/`, matching the
      new protocol types from 1.1 (keep `scripts/check-schema-drift.mjs` green).
- [x] 4.2 Add/update the OpenAPI path in `openspec/` for `/api/panels/bound`. (This project's "openspec/"
      contract for a new endpoint is the capability spec-delta under `openspec/changes/<change>/specs/`,
      not a separate swagger/OpenAPI YAML file — already authored during planning at
      `specs/bound-panel-composition/spec.md` and `specs/mcp-panel-composition-tools/spec.md`; verified
      complete and accurate against the shipped implementation, no further edits needed.)

## 5. MCP surface

- [x] 5.1 Add `createBoundPanel` to `helio-mcp/src/helioApi.ts` — single `POST /api/panels/bound` call,
      no client-side composition (contrast with `createPipelineFromShape`'s multi-call composition).
- [x] 5.2 Add the `create_bound_panel` tool to `helio-mcp/src/tools/write.ts`, documenting the
      one-call-replaces-six framing and the stage-naming failure contract.

## 6. Tests

- [x] 6.1 ScalaTest: happy path end-to-end (inline source → panel with rows present), asserting the
      returned ids and that `data_type_rows` are populated synchronously.
- [x] 6.2 ScalaTest: reuse-existing-`sourceDataSourceId` path — no new DataSource created.
- [x] 6.3 ScalaTest: unsatisfiable-binding and non-bindable-`panel.type` rejections — assert zero
      resources exist afterward (query each repo directly, not just the HTTP response).
- [x] 6.4 ScalaTest: mid-chain failure (e.g. force a run failure) — assert cleanup removes the pipeline,
      steps, output DataType, and (when applicable) the inline-created source and its companion DataType;
      assert a reused `sourceDataSourceId` is left untouched.
- [x] 6.5 ScalaTest: cross-tenant `sourceDataSourceId` → 404, not 403; no resource created.
- [x] 6.6 ScalaTest: zero-row run still returns 201 with a bound (empty) panel.
      (Also added: a regression test proving a caller-supplied `panel.config.dataTypeId` is always
      overwritten with the freshly created pipeline output — the ticket's "V41 rejection" criterion,
      exercised as a can't-be-bypassed-by-construction proof rather than a runtime-rejection test,
      since the compound endpoint never lets a caller-controlled dataTypeId reach panel creation in
      the first place — see design.md D4 step 5 "belt-and-suspenders" note.)
- [x] 6.7 MCP: unit/integration test for `create_bound_panel` covering the success and
      stage-naming-failure paths (mirrors existing write-tool test conventions).
      (helio-mcp has no Jest suite for write tools — the real existing "test convention" for this
      package's write/composition tools is `scripts/compose.ts`, a live e2e harness over the real MCP
      stdio client. Added a sibling `scripts/verify-bound-panel.ts` in that same style, and actually
      RAN it live: started the real backend, registered a user, minted a PAT, and drove
      `create_bound_panel` through the real MCP client for both the happy path (rows present
      immediately) and a steps-stage failure (asserts the "[steps]" tag surfaces verbatim and the
      failed call's pipeline is cleaned up) — both passed. See the executor's final report for the
      full transcript.)
