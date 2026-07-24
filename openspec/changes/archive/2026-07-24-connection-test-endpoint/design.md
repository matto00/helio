## Context

`Connector[Config]` (HEL-449, `domain/Connector.scala`) already defines `testConnection(config)(implicit
ec)`; `SqlConnector`/`RestApiConnector` already implement it (verified: SQL opens+closes a JDBC
connection without executing the query; REST reuses `buildRequest`'s auth/header pipeline and inspects
only response status). Nothing calls it yet. `SourceRoutes.scala` (create) and `SourcePreviewRoutes.scala`
(infer/preview/refresh) both dispatch REST vs SQL by reading a raw `type` JSON field before
`convertTo`-ing to the connector-specific request type — `/api/sources/test` follows that exact
precedent. `CreateSourceEnvelope`/`SchemaInferenceFacade` (`services/`) are the two existing
"generic-over-`Connector[Config]`, one helper for both connector types" precedents this ticket follows
for its own helper.

The frontend already has a "Test connection" button in `SqlTab.tsx` — but it calls `inferSqlSource`
(full schema inference), not a lightweight check. This ticket corrects that mislabeling as part of
introducing the real, shared affordance.

## Goals / Non-Goals

**Goals:**
- One HTTP endpoint, one frontend component, both reused by SQL and REST — no per-connector copies.
- HTTP-level success (200) even when the connection test itself fails — mirrors
  `CreateSourceEnvelope.build`'s "diagnosable, not a hard failure" pattern for connector-originated
  errors; only malformed *requests* (bad JSON, DDL/DML query, invalid auth shape) are 400s.
- Zero new secret-handling code — the response has no `config` field to redact in the first place.

**Non-Goals:**
- Changing `testConnection`'s SQL/REST semantics (out of scope per ticket; verified unchanged).
- A generic `Button` component (DESIGN.md §5 recipes apply directly).
- Wiring connectors that don't implement `Connector[Config]` yet.

## Decisions

**1. Response body: `TestConnectionResponse(ok: Boolean, error: Option[String])`, always `200 OK` from
the route's success branch.** Matches the ticket's literal `{ ok: true }` / `{ ok: false, error }`
shape and the `CreateSourceResponse.fetchError` precedent: a connector-level failure (bad credentials,
unreachable host) is domain-shaped as `ok = false`, not an HTTP error — the *request* to test a
connection succeeded even when the connection itself didn't. Malformed *requests* — SQL query containing
DDL/DML (`SqlConnector.checkQuery`, reused verbatim — same gate `createSql`/`inferSql` already run), or
an unparseable/invalid REST auth shape (`RestApiConfigPayload.toDomain` returning `Left`) — stay
`400 Bad Request` via `ServiceError.BadRequest`, identical to `inferSql`/`inferRest`'s existing
pre-checks. **Mechanism**: `spray-json` omits `error: None` from the wire entirely (not `null`) — the
route test asserts the JSON object has no `"error"` key on `ok: true`, and the frontend service layer
normalizes the field to `error: string | null` before it reaches the component (see Decision 4) so
"key absent" and "key null" are never two code paths downstream.

**Reconciling with the adjacent `BadGateway` precedent (same file):** `inferSql`/`inferRest` — in
`SourceService.scala`, the exact file this ticket extends — map the identical connector-`Left` case to
`ServiceError.BadGateway` (502), not a 200-with-domain-flag. This is a deliberate, not accidental,
divergence: `infer`'s job is to *produce a schema*, so a connector failure means the request could not
be fulfilled — an HTTP-shaped failure is correct, matching `refreshSql`/`refreshRest`'s identical
`BadGateway` mapping for the same reason. `test`'s job is different in kind: the connector's `Left` is
not a failure to fulfill the request, it *is* the fulfillment — "is this connection broken?" was asked
and answered. Treating that answer as an HTTP error would force every caller (including this ticket's
own frontend affordance) to unpack a 502 body to read a result that isn't actually exceptional. The
rule this ticket follows: a `Connector[Config]` method whose *purpose* is to report connectivity state
is domain-shaped (200 + flag); a method whose purpose is to *fetch something* and can't is HTTP-shaped
(502). `CreateSourceResponse.fetchError` already established the same split at create-time (create
succeeds at 201 even when the embedded schema-fetch fails) — this ticket's choice is consistent with
that one, not with `infer`/`refresh`'s, and both existing precedents are named here rather than citing
only the favorable one.

**2. New request wire types: none — but the two connector types use asymmetric request bodies, and
`/test` must reproduce that asymmetry exactly, not "the same discriminated type + config payload"
proposal.md's prose implies.** Verified in `dataSourceService.ts`: `inferSqlSource` posts
`{ type: "sql", config: SqlSourceConfig }` (nested, matching `SqlInferRequest`); `inferFromJson` posts
the REST config object **directly as the request body** — flat, no `config` wrapper, and critically no
`type` field either. `SourcePreviewRoutes.scala`'s `infer` dispatch supports this because it defaults
an absent/unrecognized `type` to `DataSourceKind.RestApi` before dispatching
(`.getOrElse(DataSourceKind.RestApi)`) — REST relies on that fallback rather than sending an explicit
discriminator. `/test`'s dispatch mirrors `infer`'s route-level type-sniff exactly (same fallback), so
the frontend `testConnection` function must build the SQL body nested (`{ type: "sql", config }`) and
the REST body flat (the config object itself, no wrapper, no explicit `type`) — same as
`inferSqlSource`/`inferFromJson` do today. Reusing `SqlInferRequest`/`RestApiConfigPayload` server-side
means zero new `JsonProtocols` formats for the request side; the asymmetry is a client-side
body-shaping detail, not a new wire type.

**3. New services-layer helper `services/ConnectionTest.scala`, generic over `Connector[Config]`** —
the third sibling alongside `CreateSourceEnvelope`/`SchemaInferenceFacade`, same layering rationale
(depends on nothing api/infra-specific beyond the wire response type, but lives in `services/` to match
its two siblings rather than fragmenting the precedent). `SourceService` gains `testSql`/`testRest`
methods mirroring `inferSql`/`inferRest`'s shape (pre-check → delegate → map), each calling
`ConnectionTest.run(connector, config)`. Route (`path("test")` inside `SourcePreviewRoutes.scala`,
alongside the existing `infer` dispatch it mirrors — not a new route file, since the dispatch logic is
copy-identical to `infer`'s and a third near-duplicate file would fragment the pattern) uses
`ServiceResponse.run` like every other endpoint.

**4. Frontend: `error: string | null` normalized in `dataSourceService.testConnection`, not left as
`string | undefined`.** The four prior spray-json-omission incidents (HEL-613) all trace back to a
service function returning the raw Axios payload unmodified; this ticket's regression test constructs
the mock response with the `error` key *omitted* (not `error: null`) and asserts the component renders
its idle/success state, not a broken error string.

**5. Shared component `TestConnectionAffordance` (`frontend/src/features/sources/ui/`) calls the plain
async `testConnection` service function directly — no Redux slice thunk, no slice state.** This
mirrors the existing `createRestSource`/`createCsvSource`/`createTextSourceUpload` precedent (plain
async functions awaited directly inside a component, `AddSourceModal.tsx`), not the
`inferSqlSource`/`createSqlSource` precedent (`createAsyncThunk` + slice-owned `items`/`status`).
The distinguishing factor: those slice thunks exist because their result feeds shared state
(`state.sources.items`) or a value multiple call sites read; `testConnection`'s result is consumed by
exactly one component instance, is never persisted, and no other view needs it. The component owns its
own local pending/success/error state (mirroring `SqlTab`'s existing local-state pattern for its
current button). Props: `type: "sql" | "rest_api"`, `buildConfig: () => SqlSourceConfig |
RestApiConfigBody`, `disabled?: boolean`. States: idle (button only) → pending ("Testing…", disabled)
→ success (`✓ Connected`, `--app-success` text, DESIGN.md §8: color is reinforcement, not sole carrier
— the word "Connected" carries the meaning) → error (`InlineError` below the button, per epic brief's
InlineError mandate). Button follows DESIGN.md §5 **Secondary** recipe (matches `SqlTab`'s existing
button class today). No `sourcesSlice.ts` changes are needed for this component.

**5a. `TestConnectionAffordance`'s button MUST render `type="button"`, matching `SqlTab`'s existing
buttons.** `AddSourceModal.tsx` wraps `SqlTab`, `RestApiForm`, and `CsvForm` inside one native
`<form id="add-source-configure-form" onSubmit={handlePreview}>` (`AddSourceModal.tsx:413-449`) —
`SqlTab`'s current buttons already carry explicit `type="button"` for exactly this reason (a bare
`<button>` inside a `<form>` defaults to `type="submit"` and would fire `handlePreview` →
`inferFromJson`/native form submission on click). Without `type="button"` on the new component, a
click on "Test connection" inside `RestApiForm` would submit the surrounding form and silently
advance the modal to the preview step — a real behavior collision, not a style nit, since
`RestApiForm` has no such button today and gets this wiring for the first time in this ticket. A
frontend test asserts a click does not call `inferFromJson`/advance `AddSourceModal`'s `step` state.

**6. `SqlTab.tsx` gets a new, additional control — its existing button is renamed, not repurposed.**
The skeptic correctly flagged that repurposing the existing "Test connection" button (today the *only*
trigger for `inferSqlSource`/`inferredFields`) to call the new lightweight `testConnection` would
permanently disable "Create source" (gated on `inferredFields !== null`, `SqlTab.tsx:199`) — nothing
would populate `inferredFields` anymore. Resolution: the existing button is **renamed to "Infer
schema"**, keeping its `inferSqlSource` dispatch, `inferredFields` state, `DataGrid` preview, and
Create-source gating byte-for-byte unchanged. `<TestConnectionAffordance type="sql"
buildConfig={buildConfig} />` is added as a **new, separate** control in the same actions row. This is
purely additive to the create flow — cheap pre-flight check (new) alongside the existing, unchanged
expensive schema-discovery step (renamed only) — and requires no re-gating of "Create source." The
alternative (dropping the preview step, gating Create on test-connection success) is a real UX change
to a working flow and out of scope for a ticket about *adding* a connection-test capability.

## Risks / Trade-offs

- [Risk] REST `testConnection`'s error message embeds the raw upstream response body
  (`RestApiConnector.scala:106`, pre-existing HEL-449 behavior, not introduced here) — if the external
  API ever echoed a caller's own Authorization header back in an error body, that would surface to the
  user. → Mitigation: this is identical to `doFetch`'s existing HEL-468 error-message shape (not a
  regression this ticket introduces); flagging as a pre-existing pattern, not fixing in scope (any
  third-party API could theoretically echo unrelated data in error bodies — the request-side
  credential itself is never included in *our* error message, only whatever the remote server chose to
  send back).
- [Trade-off] `TestConnectionAffordance` isn't yet wired into `CsvForm`/`StaticSourceForm`/etc. because
  those connectors don't implement `Connector[Config]` — accepted per ticket's stated non-goal; the
  component's props are connector-agnostic so future forms adopt it without a rewrite.

## Planner Notes

- Self-approved: extending `SourcePreviewRoutes.scala` rather than a new route file — the dispatch
  logic is structurally identical to the existing `infer` path in the same file; a separate file would
  duplicate ~15 lines of type-sniffing boilerplate for no isolation benefit.
- Self-approved: no new JSON Schema in `schemas/` — no existing `/api/sources/*` endpoint (create,
  infer, preview) has schema coverage today; adding one solely for `/test` would be inconsistent with
  the surrounding surface, not a completion of missing coverage this ticket owns.
- Self-approved: component name `TestConnectionAffordance` over `TestConnectionButton` — it renders
  button + status text + error, not just a button.
