# HEL-449: Connector SPI: shared trait (test / inferSchema / fetch / refresh)

## Context

Today each source kind has its own ad-hoc shape. `SqlConnector` (`backend/src/main/scala/com/helio/domain/SqlConnector.scala`) is a stateless `object` with `connect`/`execute`/`inferSchema`/`toRows`; `RestApiConnector` (`domain/RestApiConnector.scala`) is a class with `fetch`/`toRows`; content sources live in `services/*Support.scala`. `SourceService` (`services/SourceService.scala`) hand-wires `createRest`/`createSql`/`inferRest`/`inferSql`/`refreshRest`/`refreshSql` per kind. There is no common interface, so every new v1.9 connector re-implements the same lifecycle by copy-paste and the agent connector menu (HEL-429 registry) has nothing uniform to enumerate.

This ticket introduces the shared Connector SPI trait that every subsequent v1.9 connector implements. It is the foundation the other connector epics (424/425/426/427/428) build on.

## Scope

- New trait `Connector` in `backend/src/main/scala/com/helio/domain/` (or `services/`) defining the lifecycle every connector supports:
  - `testConnection(config): Future[Either[String, Unit]]` — cheap reachability/auth check (no full fetch).
  - `inferSchema(config): Future[Either[String, InferredSchema]]` — reuse `domain.SchemaInferenceEngine` (see `SqlConnector.inferSchema` / `SchemaInferenceEngine.fromJson`).
  - `fetch(config, maxRows): Future[Either[String, Vector[JsValue]]]` — normalized row output (JsObject per row), the shape `SchemaInferenceEngine` and `SourceService` already consume.
  - `refresh` semantics documented on the trait (full re-fetch is the default; incremental is HEL-428).
- Associated capability metadata hook (`kind: String`, `displayName`, `supportsIncremental: Boolean`, `authKind`) consumed by the HEL-429 connector registry — keep the metadata surface minimal here; the registry ticket owns aggregation.
- Refactor `SqlConnector` and `RestApiConnector` to implement the new trait WITHOUT behavior change (adapter/wrapper is acceptable; keep the existing `object`/class if a thin `Connector` façade is cleaner). This proves the SPI against the two real connectors.
- No inline fully-qualified names in Scala (per CONTRIBUTING.md) — import at top.

## Acceptance criteria

- The `Connector` trait compiles and both `SqlConnector` and `RestApiConnector` are reachable through it.
- Existing REST and SQL create/infer/refresh behavior is unchanged (existing `SourceService` tests still pass); the fetch-error envelope (`CreateSourceResponse` `dataType: null` + `fetchError`) is still produced on fetch failure.
- Read-only enforcement for SQL (`SqlConnector.checkQuery` DDL/DML rejection) remains on the SQL path.
- Credential redaction is unaffected (still handled in `DataSourceProtocol.DataSourceResponse.fromDomain`).
- New ScalaTest coverage for the trait contract (a test connector implementing the SPI; assert lifecycle dispatch).
- Backward-compatible: no wire-shape or DB-shape change; `data_sources.source_type` / `config` unchanged.

## Out of scope

- Any new concrete connector (Sheets/BigQuery/GCS/etc.) — those are their own tickets that depend on this one.
- The connector registry aggregation and connection-test HTTP endpoint (separate HEL-429 tickets).
- Incremental/streaming refresh (HEL-428 / large-result ticket).

## Dependencies

- None (foundation). Blocks the concrete-connector tickets across 424/425/426/427/428.

## Epic context (for this workflow, not literal ticket scope)

This is the first ticket of the HEL-429 "Connector Framework Hardening" epic (v1.9 Data Connectors). Five siblings follow sequentially on top of this one:

- HEL-473 — schema-inference facade
- HEL-468 — uniform fetch-error envelope
- HEL-460 — centralized secret storage + redaction
- HEL-480 — connection-test endpoint + UI
- HEL-484 — connector registry + capability metadata

The SPI landed here is the seam all five build on. Prefer a trait shape the siblings can extend without a breaking rewrite. Note in the OpenSpec design doc which sibling ticket owns which follow-on concern rather than pulling their scope forward into this change.

## Repo gotchas

- spray-json omits `Option = None` from the wire entirely (not `null`). Any new Option-typed field crossing to the frontend needs absent→null normalization at the service boundary; regression tests must construct fixtures with the key OMITTED, not set to null. (Not expected to be triggered by this ticket, since it is backend-internal SPI, but keep in mind if any DTO surfaces change.)
- No inline fully-qualified names in Scala — import at top (CONTRIBUTING.md hard rule).
- Structural refactors must be behavior-preserving. This ticket is largely a refactor unifying SqlConnector/RestApiConnector behind one trait. Existing endpoint behavior, error strings, and response shapes must not change unless explicitly requested. Trivial bugs found along the way: fix inline. Non-trivial bugs: report as spinoff-ticket candidates, do not fix in-scope.
