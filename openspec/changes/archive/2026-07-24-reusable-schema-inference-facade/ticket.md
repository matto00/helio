# HEL-473: Reusable schema-inference facade across connectors

## Context

Schema inference is already centralized in `SchemaInferenceEngine.fromJson(JsArray)` (called via `SqlConnector.inferSchema` and directly in `SourceService.inferRest`), producing `InferredSchema(fields: Seq[InferredField])` (`backend/src/main/scala/com/helio/domain/model.scala`). But each connector must convert its native rows into the `JsArray` the engine expects, and there is no single documented "rows → InferredSchema → DataField" path — `SourceService` open-codes the `InferredField` → `DataField` mapping (with optional field overrides) twice.

## Scope

* A single `inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema` facade on top of `SchemaInferenceEngine`, plus the shared `InferredField` → `DataField` projection (honoring `FieldOverridePayload` overrides where a connector supports them, as REST does today).
* Route the SPI's `inferSchema` (HEL-449) and the create/refresh paths in `SourceService` through this facade WITHOUT changing inferred output.
* Document how a new connector supplies rows so inference "just works" (header-row connectors like Sheets, tabular warehouse connectors, object-storage parsers all funnel here).

## Acceptance criteria

* Inferred schemas for existing REST/SQL sources are unchanged (existing tests pass).
* The `InferredField` → `DataField` mapping with field overrides is defined once and reused.
* A test connector supplying arbitrary rows produces a correct `InferredSchema` via the facade.
* Backward-compatible.

## Out of scope

* Changing the inference heuristics themselves (type promotion, nullability) — behavior-preserving only.

## Dependencies

* Blocked by HEL-449 (Connector SPI) — MERGED to main as d6fe6a45 (PR #273), 2026-07-24.

## Epic context

Second ticket of the HEL-429 "Connector Framework Hardening" epic (v1.9 Data Connectors).
Remaining siblings after this one (do not pull their scope forward): HEL-468 (uniform
fetch-error envelope), HEL-460 (centralized secret storage + redaction), HEL-480
(connection-test endpoint + UI), HEL-484 (connector registry + capability metadata).

## Inherited note from HEL-449's final skeptic gate (non-blocking, relevant to design)

`RestApiConnector`'s trait-level wrapper uses the caller-supplied implicit `ec`, while the
pre-existing async I/O underneath still runs on the class's own `system.executionContext`.
It's harmless today because that I/O is non-blocking — but it means "the caller controls the
ExecutionContext" is not uniformly true all the way down for REST. If this facade introduces
polymorphic dispatch over connectors, decide explicitly whether that asymmetry matters and
document the decision rather than leaving it implicit. HEL-449's design gate REFUTEd round 1
for exactly this class of unspecified-EC gap — expect the skeptic to probe it here too.

## Repo-specific gotchas

* spray-json omits `Option = None` from the wire entirely (not `null`). Any new Option-typed
  field crossing to the frontend needs absent→null normalization at the service boundary, with
  regression tests constructing fixtures with the key OMITTED. Tracking ticket: HEL-613.
* No inline fully-qualified names — hard rule in CONTRIBUTING.md.
* Behavior preservation is mandatory. `SchemaInferenceRegressionSpec` is the guard and must
  pass unmodified. Do not edit existing test suites to accommodate new code.
