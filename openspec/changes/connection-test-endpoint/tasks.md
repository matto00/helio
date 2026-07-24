## 1. Backend

- [x] 1.1 Add `TestConnectionResponse(ok: Boolean, error: Option[String])` case class + `RootJsonFormat`
      to `DataSourceProtocol.scala` (design Decision 1/2 — no new request types needed).
- [x] 1.2 Add `services/ConnectionTest.scala`: `run[Config](connector: Connector[Config], config:
      Config)(implicit ec): Future[TestConnectionResponse]` mapping `testConnection`'s
      `Right(())`/`Left(err)` to `ok = true`/`ok = false, error = Some(err)` (design Decision 3).
- [x] 1.3 Add `SourceService.testSql(request: SqlInferRequest)` — reuse `SqlConnector.checkQuery` gate
      (mirrors `inferSql`), then delegate to `ConnectionTest.run(SqlConnector, sqlConfig)`.
- [x] 1.4 Add `SourceService.testRest(payload: RestApiConfigPayload)` — reuse
      `RestApiConfigPayload.toDomain` gate (mirrors `inferRest`), then delegate to
      `ConnectionTest.run(connector, restConfig)`.
- [x] 1.5 Add `path("test")` to `SourcePreviewRoutes.scala`, mirroring the existing `path("infer")`
      type-sniff/dispatch block exactly — same `.getOrElse(DataSourceKind.RestApi)` fallback, same
      `convertTo[SqlInferRequest]` (nested) vs `convertTo[RestApiConfigPayload]` (flat) split (design
      Decision 2) — calling `sourceService.testSql`/`testRest` via `ServiceResponse.run`.
- [x] 1.6 Update `SourcePreviewRoutes.scala`'s class doc comment to mention `/test` alongside
      `infer|:id/preview|:id/refresh`.

## 2. Frontend

- [x] 2.1 Add `testConnection(type, config)` to `dataSourceService.ts`: build the SQL request body
      nested (`{ type: "sql", config }`, matching `inferSqlSource`) and the REST request body flat
      (the config object directly, no wrapper, no `type` field, matching `inferFromJson`) — design
      Decision 2. Post to `/api/sources/test` and normalize an absent `error` key to `error: null` in
      the returned value (design Decision 4 — return type `{ ok: boolean; error: string | null }`).
      Plain async function, no slice thunk (design Decision 5) — do not add anything to
      `sourcesSlice.ts`.
- [x] 2.2 Create `TestConnectionAffordance.tsx` in `frontend/src/features/sources/ui/`: idle / pending
      ("Testing…", disabled) / success (`--app-success` text, e.g. "Connected") / error (`InlineError`)
      states; props `type`, `buildConfig`, `disabled?`; calls `testConnection` directly (no dispatch);
      button follows DESIGN.md §5 Secondary recipe. **The button MUST render `type="button"`** (design
      Decision 5a) — `AddSourceModal.tsx` wraps `SqlTab`/`RestApiForm`/`CsvForm` in one native
      `<form onSubmit={handlePreview}>`, and a submit-typed button would fire that form's submit
      instead of just triggering the test.
- [x] 2.3 In `SqlTab.tsx`: rename the existing button (and its label/aria text) from "Test connection"
      to "Infer schema" — its `inferSqlSource` dispatch, `inferredFields` state, `DataGrid` preview,
      and `disabled={isSaving || isTesting || inferredFields === null}` gating on "Create source" are
      otherwise unchanged (design Decision 6). Add `<TestConnectionAffordance type="sql"
      buildConfig={buildConfig} />` as a new, additional control in the same actions row.
- [x] 2.4 Wire `TestConnectionAffordance` into `RestApiForm.tsx` (new addition — REST currently has no
      test-connection affordance at all); pass `buildConfig` sourced from the form's `url`/`jsonPath`
      state the same way `AddSourceModal.handlePreview` already assembles the REST config object.
      Confirm (see task 3.4) that clicking it does not submit `AddSourceModal`'s configure-step form.

## 3. Tests

- [x] 3.1 Backend route test (new or extend `DataSourceRoutesSpec.scala`-style spec) covering: SQL
      success, SQL failure (curated message, not raw driver text), SQL DDL/DML rejection (400,
      connector never invoked), REST success (2xx, non-JSON body), REST failure (non-2xx), REST
      malformed-auth rejection (400). Include one request-shape test per connector type asserting the
      route accepts the SAME nested-SQL/flat-REST body shapes `/api/sources/infer` already accepts
      (design Decision 2) — not a symmetric `{ type, config }` shape for both.
- [x] 3.2 Backend test asserting the serialized `TestConnectionResponse` JSON has no `error` key when
      `ok: true` (spray-json omission — construct the assertion by parsing the raw JSON string, not by
      round-tripping through the case class).
- [x] 3.3 Backend test asserting no field of the connection-test response derives from `config`
      (password/token/auth absent from the serialized response for both a success and a failure case).
- [x] 3.4 Frontend test for `TestConnectionAffordance` covering idle → pending → success and idle →
      pending → error transitions, plus the case in spec's "Absent `error` field on success" scenario
      (mock response with the `error` key omitted, not `null`). Add a test rendering the affordance
      inside `RestApiForm` within `AddSourceModal`'s configure-step form and asserting a click on
      "Test connection" does NOT call `inferFromJson`/advance the modal's `step` state (design
      Decision 5a — the `type="button"` requirement, enforced by a test not just the prop).
- [x] 3.5 Update `SqlTab.test.tsx`'s two existing tests that click the button named "Test connection"
      and assert `inferSqlSource`-driven behavior ("shows inferred fields on successful test
      connection", "shows inline error on test connection failure"): these MUST be updated (not left
      "unmodified") to click the renamed "Infer schema" button — their assertions on inferred-fields/
      error-rendering behavior are otherwise unchanged, since `inferSqlSource`'s wiring didn't move.
      This is a disclosed, expected update per design Decision 6's rename, not a silent edit
      accommodating new code. Add new test(s) for the new "Test connection" button's presence and
      independent behavior in the same file. Confirm `sourcesSlice.test.ts` passes unmodified (no
      slice changes in this ticket).
- [x] 3.6 Run `sbt test` (backend) and the full npm gate chain (lint, format:check, test, build)
      (frontend) before declaring done.

## 4. UI review

- [x] 4.1 Start dev servers (documented ports) and manually exercise both `SqlTab`'s "Test connection"
      / "Infer schema" pair and `RestApiForm`'s new "Test connection" affordance via Playwright —
      capture screenshots into the change's openspec directory (never the repo root) for idle/pending/
      success/error states, and confirm "Infer schema" still gates "Create source" as before.
