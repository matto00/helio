# Files modified — connection-test-endpoint (HEL-480)

## Backend

- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — new
  `TestConnectionResponse(ok: Boolean, error: Option[String])` case class + `RootJsonFormat`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-export `TestConnectionResponse` into
  `com.helio.api` (matches the existing re-export pattern for every other `DataSourceProtocol` type,
  needed so `DataSourceRoutesSpec` can reference it unqualified).
- `backend/src/main/scala/com/helio/services/ConnectionTest.scala` — new. Generic
  `run[Config](connector: Connector[Config], config: Config)` helper mapping `testConnection`'s
  `Either[String, Unit]` to `TestConnectionResponse`; the third sibling alongside
  `CreateSourceEnvelope`/`SchemaInferenceFacade`.
- `backend/src/main/scala/com/helio/services/SourceService.scala` — new `testSql`/`testRest` methods
  mirroring `inferSql`/`inferRest`'s pre-check → delegate shape, calling `ConnectionTest.run`.
- `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` — new `path("test")` block
  mirroring the existing `path("infer")` type-sniff/dispatch exactly (same
  `.getOrElse(DataSourceKind.RestApi)` fallback, same nested-SQL/flat-REST body split); class doc
  comment updated to mention `/test`.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — new `"POST /api/sources/test"`
  test block (SQL success/failure/DDL-rejection, REST success/failure/malformed-auth-rejection,
  request-shape parity with `/infer`, no-credential-echo for both connector types and both outcomes,
  raw-JSON assertion that `error` is omitted on `ok: true`); two new local test-server routes
  (`test-ok`, `test-fail`) for the REST scenarios (`testConnection` issues a real HTTP request, unlike
  `fetch`, so the existing `fetchOverride` stub connectors don't apply).

## Frontend

- `frontend/src/features/sources/services/dataSourceService.ts` — new `testConnection(type, config)`
  plain async function (no slice thunk); builds the SQL body nested / REST body flat, matching
  `inferSqlSource`/`inferFromJson`; normalizes an absent `error` key to `null`.
- `frontend/src/features/sources/ui/TestConnectionAffordance.tsx` — new shared component (idle /
  pending / success / error states); `type="button"` on the button (Decision 5a regression guard).
- `frontend/src/features/sources/ui/TestConnectionAffordance.css` — new; layout for the button +
  inline success text + `InlineError` row.
- `frontend/src/features/sources/ui/TestConnectionAffordance.test.tsx` — new; idle/pending/success,
  idle/pending/error, absent-`error`-key-on-success regression, `disabled` prop.
- `frontend/src/features/sources/ui/SqlTab.tsx` — renamed the existing "Test connection" button (and
  its label) to "Infer schema" (dispatch/state/gating unchanged); added the new
  `TestConnectionAffordance` as a second, independent control in the same actions row.
- `frontend/src/features/sources/ui/SqlTab.css` — new; groups the two actions-row buttons.
- `frontend/src/features/sources/ui/SqlTab.test.tsx` — updated the two existing tests that clicked
  "Test connection" (now "Infer schema") to click the renamed button; added new tests for the new
  "Test connection" button's presence and independent success/error behavior.
- `frontend/src/features/sources/ui/RestApiForm.tsx` — wired in `TestConnectionAffordance` (new
  capability — REST had no test-connection control before); `buildConfig` mirrors
  `AddSourceModal.handlePreview`'s REST config-building.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — added a new describe block: renders
  the affordance in the default (REST API) tab, and the Decision 5a regression test (click doesn't
  call `inferFromJson` or advance past the configure step).

## Not modified (confirmed)

- `frontend/src/features/sources/state/sourcesSlice.ts` / `sourcesSlice.test.ts` — untouched, per
  design Decision 5 (plain async function, no slice thunk); `sourcesSlice.test.ts` passes unmodified.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — untouched; `SourcePreviewRoutes` was
  already wired in.
