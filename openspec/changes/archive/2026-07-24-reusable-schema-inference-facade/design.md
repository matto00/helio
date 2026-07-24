## Context

`SchemaInferenceEngine.fromJson(JsArray)` is the one true inference engine, but every caller
hand-rolls the "rows → JsArray → InferredSchema" wrap: `SqlConnector.inferSchema(rows)` does
`JsArray(rows.map(JsObject(_)))` then `fromJson`; `SourceService.inferRest`/`RestApiConnector`'s
trait `inferSchema(config)` call `fromJson` directly on the raw REST response `JsValue` (not via
`toRows`). Separately, `SourceService` open-codes `InferredField` → `DataField` three times
(`createSql`/`refreshSql`/`refreshRest`, no overrides) and once with overrides (`createRest`).
HEL-449 added `Connector[Config].inferSchema(config)(implicit ec)` on both connectors but explicitly
left `SourceService` calling `execute`/`fetch` + inference by hand (see HEL-449 design.md "Sibling
ownership map": this ticket owns "polymorphic dispatch through the trait").

## Goals / Non-Goals

**Goals:**
- One `inferSchemaFromRows(rows: Vector[JsValue]): InferredSchema` facade, proven equivalent to
  today's per-connector inference for every existing input shape (JsArray, single JsObject, scalar).
- One `InferredField` → `DataField` projection (override-aware), replacing all four inline copies
  in `SourceService`.
- `SourceService`'s six create/infer/refresh methods call `Connector.inferSchema(config)`
  (the SPI trait method) instead of hand-dispatching `execute`/`fetch` + inference — the polymorphic
  dispatch HEL-449 deferred to this ticket.
- Zero change to inferred output — `SchemaInferenceRegressionSpec` passes unmodified.

**Non-Goals:**
- `DataSourceService`'s CSV/Static paths (own service, not part of the Connector SPI; the same
  `InferredField`→`DataField` duplication exists there but is out of scope — flagged as a follow-up).
- Changing `fromJson`'s inference heuristics.
- Any sibling ticket's scope (error envelope, secrets, connection-test endpoint, registry).

## Decisions

**1. `inferSchemaFromRows` lives in `domain/SchemaInferenceEngine`, not a new domain type.**
It is exactly `fromJson(JsArray(rows))` — a one-line facade over the existing engine, matching the
row shape `Connector.fetch` already returns (`Vector[JsValue]`, one `JsObject` per row). Verified
behavior-equivalent to every existing call site:
- `SqlConnector.inferSchema(rows: Seq[Map[String, JsValue]])`: `toRows(rows)` (already defined,
  identical to the JsArray construction `inferSchema` does today) fed into the facade reproduces the
  current output exactly.
- `RestApiConnector`'s trait `inferSchema(config)` calls `fromJson` on the *raw* response `JsValue`,
  not row-shaped output. `RestApiConnector.toRows(json)` case-matches `JsArray→elements.toVector`,
  `JsObject→Vector(obj)`, `other→Vector(other)`. Feeding each through `inferSchemaFromRows` reproduces
  `fromJson`'s three branches exactly: a one-element-array-of-one-object merges to that object
  (`mergeObjects` on a singleton list is a no-op copy, confirmed by reading `SchemaInferenceEngine`);
  a non-object scalar collects to zero objects in the `JsArray` branch, matching `fromJson`'s
  `case _ => InferredSchema(Seq.empty)` for a bare scalar.

**2. The `InferredField`→`DataField` projection lives in a new `services/SchemaInferenceFacade.scala`,
not domain, with signature `def toDataFields(schema: InferredSchema, overrides: Map[String,
FieldOverridePayload] = Map.empty): Vector[DataField]`.** `FieldOverridePayload` is an api-protocol
type (`api/protocols/DataSourceProtocol.scala`) — domain must not depend on api types (api depends on
domain, never the reverse; `Connector.scala` and `SchemaInferenceEngine.scala` have zero api imports
today). `services/SourceConfigParsing.scala` already establishes the precedent of a small
services-layer object built directly around `FieldOverridePayload`, so this follows the same layering
rather than inventing a parallel domain-level override type purely to keep the projection in
`domain/`. The default empty map lets `createSql`/`refreshSql`/`refreshRest` (no overrides today)
call `toDataFields(schema)` while `createRest` calls `toDataFields(schema, overridesMap)`.

**2a. Documentation lives on `Connector[Config]`'s existing trait-level doc comment in
`domain/Connector.scala`, not a new doc file.** HEL-449 already used that doc comment to state the
ExecutionContext contract every sibling ticket must follow (see its `'''ExecutionContext'''` doc
block) — the same location is where a sibling-ticket implementer (Sheets, warehouse, object-storage
connectors) will actually look for "how do I get inference right." This ticket adds a
`'''Schema inference'''` doc block stating that any `fetch` output (`Vector[JsValue]`, one row per
element) funnels directly into `SchemaInferenceEngine.inferSchemaFromRows` for a correct
`InferredSchema` — no connector-specific inference logic needed.

**3. `SourceService`'s six methods call `Connector.inferSchema(config)` (the SPI trait method),
replacing direct `execute`/`fetch` + inline inference — the trait's `inferSchema` already delegates
to `inferSchemaFromRows` (Decision 1), so this one swap gets both the SPI wiring and the facade
routing simultaneously.** Confirmed parameter-for-parameter equivalent to today's call sites:
`SqlConnector.inferSchema(config)` internally calls `execute(config, maxRows = 100)` — the exact
`maxRows` every `SourceService` SQL call site already used. `RestApiConnector.inferSchema(config)`
calls the same `fetch(config)` + `fromJson(json)` `inferRest`/`refreshRest`/`createRest` already did
directly. `previewSql`/`previewRest` are untouched — they need raw rows for computed-field
evaluation, not inferred schema, so they keep calling `execute`/`fetch` directly.

**4. ExecutionContext: no new call sites cross a boundary — `SourceService` already threads its own
`implicit ec` into every `execute`/`fetch` call; `Connector.inferSchema(config)(implicit ec)` takes
the same parameter, so the caller-supplied-EC invariant HEL-449 established is preserved unchanged.
This facade adds no new place where an EC could be silently defaulted — both `SqlConnector` (object,
no state) and `RestApiConnector` (class, `implicit system: ActorSystem`) continue to require the
caller to supply `ec` explicitly, exactly as `Connector[Config]`'s trait signature mandates.
Explicitly naming the pre-existing asymmetry HEL-449's final skeptic gate flagged, so a future reader
doesn't have to re-derive it from the archive: `RestApiConnector`'s trait-level `inferSchema`/`fetch`
wrappers `.map` the caller-supplied `ec`, but the async I/O underneath (`doFetch`'s
`Http(...).singleRequest(...)`) still runs on the class's own `private implicit val ec =
system.executionContext` (line 30), not the caller's. This ticket does not touch `doFetch` or
introduce any new call into it, so the asymmetry is unchanged and out of scope here — it is
inherited, not introduced, and does not affect this facade's correctness (the caller's `ec` is only
ever used to transform an already-completed `Future`'s result, never to run blocking work, so there
is no dispatcher-starvation risk from this ticket's changes).**

**5. `schema-inference-facade` is a new capability spec, not a `connector-spi` delta.** The
`connector-spi` spec's "Existing SqlConnector/RestApiConnector behavior unchanged" requirement
already covers "the SPI's external contract does not change" — this ticket's *new* testable surface
(the facade functions + the documented "supply rows, get inference" contract for future connectors)
is additive capability, not a change to `connector-spi`'s existing requirements.

## Risks / Trade-offs

- [Risk] Routing `SourceService`'s create/refresh paths through `Connector.inferSchema(config)`
  collapses two calls (fetch rows, then infer) into one, changing the `fetchError` early-return
  timing very slightly (no separate raw-rows step). Mitigation: verified `Left` branch of
  `Connector.inferSchema` produces the identical error string as the current `execute`/`fetch` `Left`
  branch (it forwards the same `Either`), so the observable `fetchError` value is unchanged.
- [Trade-off] `DataSourceService`'s CSV path keeps its own inline `InferredField`→`DataField`
  copies (Non-Goal). Flagged as a spinoff-ticket candidate rather than fixed here, to keep this
  change scoped to the v1.9 Connector SPI per the epic's sibling-ownership discipline.

## Planner Notes

- Chose `task/` branch prefix — internal refactor/infra seam, no new user-facing behavior (matches
  HEL-449's precedent).
- Self-approved: new `schema-inference-facade` capability spec (additive, not a `connector-spi`
  delta) — no existing `connector-spi` requirement text changes.
- Self-approved: leaving `DataSourceService`'s CSV duplication as a documented non-goal rather than
  pulling it into scope — ticket text names `SourceService` specifically, and CSV isn't a v1.9
  Connector SPI implementation.
- Design-gate round 1 REFUTE: the documentation requirement (ticket Scope bullet 3, proposal "What
  Changes" bullet 4) had no task behind it and no checkable acceptance signal in
  specs/schema-inference-facade/spec.md. Fixed by adding task 1.3 (extend `Connector.scala`'s
  existing trait-level doc comment, following HEL-449's `'''ExecutionContext'''` precedent) and a
  checkable scenario for the requirement (Decision 2a). Also folded in the two non-blocking notes:
  Decision 4 now names the pre-existing REST EC/I-O asymmetry explicitly, and Decision 2 states
  `SchemaInferenceFacade.toDataFields`'s exact signature.
