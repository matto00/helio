## Why

There is no way to validate a connector's config/credentials before committing to a full create +
fetch. HEL-449 added `Connector.testConnection` to the SPI specifically for this ticket to expose;
today it has no caller. Warehouse/OAuth connectors are slow/expensive to fully fetch, so a cheap
pre-flight check meaningfully improves the create-source flow.

## What Changes

- Add `POST /api/sources/test`: dispatches to `Connector.testConnection` for `sql`/`rest_api` using
  the same request-body dispatch pattern `/api/sources/infer` already uses (SQL nested under
  `config`, REST flat, per design.md — the two shapes are asymmetric today and `/test` reproduces
  that exactly rather than inventing a new uniform shape), returning `{ ok: true }` or
  `{ ok: false, error }`. Implemented as a new `path("test")` block inside the existing
  `SourcePreviewRoutes.scala` (already wired into `ApiRoutes.scala`) — no `ApiRoutes.scala` changes
  needed. Error messages reuse `testConnection`'s existing curated categories ("SQL connection
  failed", "Request failed", etc.) unmodified — no new message-curation logic.
- Add a reusable `TestConnectionAffordance` (name finalized in design) frontend component with
  pending/success/error states, backed by a new `testConnection` service call (plain async function,
  no slice thunk — see design.md Decision 5), usable by any source form. Wire it into `SqlTab.tsx`
  and `RestApiForm.tsx` — the two SPI-backed connectors available today.
- Rename `SqlTab.tsx`'s existing "Test connection" button to "Infer schema" — it already calls
  `inferSqlSource` (a full schema-inference round trip, not a cheap test) and gates "Create source"
  on its result; that behavior is unchanged, only mislabeled today. The new
  `TestConnectionAffordance` is added as a distinct, additional control alongside it — see
  design.md Decision 6.
- No response payload ever echoes connector config back — the test endpoint's request is
  write-only from the client's perspective; the response carries no `config` field to redact.

## Capabilities

### New Capabilities

- `connection-test-endpoint`: the `POST /api/sources/test` contract (request/response shape, SQL/
  REST dispatch, curated-error passthrough) and the shared frontend "test connection" UI pattern
  (pending/success/error states, no config echoed back).

### Modified Capabilities

- `sql-database-connector`: the existing "Frontend SQL Database tab" requirement binds a
  "Test connection" button to `POST /api/sources/infer` (schema-preview behavior). This ticket
  renames that button to "Infer schema" (behavior unchanged) and reassigns the label
  "Test connection" to the new, separate `/api/sources/test`-backed control — see design.md
  Decision 6.

## Non-goals

- Wiring connectors not yet built (CSV, static, text, PDF, image) — they adopt the shared endpoint/
  affordance when their forms are built; `Connector.testConnection` doesn't exist for them yet.
- Connector registry / capability metadata aggregation (HEL-484).
- Changing `testConnection`'s existing SQL/REST semantics (open+close without executing; status-only
  REST check) — this ticket only exposes the existing method over HTTP.
- A new shared `Button` component — DESIGN.md's button recipes (§5) apply as-is.

## Impact

- `backend/src/main/scala/com/helio/api/routes/SourcePreviewRoutes.scala` — new `path("test")`
  route (no `ApiRoutes.scala` change; this route class is already wired in).
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — new
  `TestConnectionResponse` wire type + format (no new request types — reuses `SqlInferRequest`/
  `RestApiConfigPayload`).
- `backend/src/main/scala/com/helio/services/` — new `ConnectionTest.scala` helper generic over
  `Connector[Config]`, following `CreateSourceEnvelope`/`SchemaInferenceFacade` layering precedent;
  new `SourceService.testSql`/`testRest` methods.
- `frontend/src/features/sources/services/dataSourceService.ts` — new `testConnection` call
  (plain async function, no slice thunk).
- `frontend/src/features/sources/ui/` — new shared `TestConnectionAffordance` component;
  `SqlTab.tsx` (rename existing button, add the new one), `RestApiForm.tsx` (new addition) updated
  to use it.
- No `sourcesSlice.ts` changes — the new affordance's result has exactly one consumer and is never
  persisted (design.md Decision 5).
- `openspec/specs/sql-database-connector/spec.md` — MODIFIED at archive time per this change's
  `specs/sql-database-connector/spec.md` delta (button rename + new control binding).
