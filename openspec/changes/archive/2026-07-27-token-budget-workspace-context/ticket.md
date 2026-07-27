# HEL-377 — Token-budget controls for enriched workspace context

## Context

Sample rows, column stats, and semantic/join hints (sibling HEL-345 tickets) make the
workspace-context payload much larger. When this context is fed into a server-side Claude call
(HEL-341 authoring endpoint) it consumes prompt tokens and cost, and a large workspace could blow
the context window. The enriched context must fit within a configurable token/byte budget,
degrading **deterministically** rather than truncating arbitrarily.

Touches: `WorkspaceContextService` (backend) and `helio-mcp/src/context.ts`; the budgeting layer
wraps the assembled snapshot before it is serialized for a model.

## Scope

- Backend Scala: add a deterministic budgeting pass over the assembled context that trims to a
  configured budget in a fixed priority order (e.g. keep all structure; then shrink sample-row
  count; then example-value lists; then join-hints) — never random, always the same result for
  the same input + budget.
- Expose the budget as config (a bounded default, overridable) and surface which sections were
  truncated (a `truncated` marker / omitted-count) so a consumer knows the context is partial.
- MCP TS: apply the same deterministic budgeting in `buildWorkspaceContext` (shared ordering) so
  both surfaces produce equivalent trimmed output.
- Optionally accept a `budget`/`detail` query param on `GET /api/workspace/context` so the
  authoring endpoint can request a tighter context than an interactive read.
- Tests: backend ScalaTest that an over-budget workspace trims in the documented order and is
  idempotent/deterministic; MCP unit test for the same ordering.

## Acceptance criteria

- [ ] Enriched context is trimmed to fit a configured token/byte budget; the trim order is
      documented and fixed.
- [ ] Trimming is deterministic: identical input + budget yields byte-identical output across
      runs.
- [ ] The payload flags when it was truncated and what was dropped (marker / counts), so
      downstream (Claude prompt) can note the context is partial.
- [ ] Structural identity of resources (all sources/types/pipelines/dashboards present) is
      preserved even at the tightest budget; only value-level enrichment is shed.
- [ ] Backend + MCP apply the same ordering (parity test or shared spec).
- [ ] `sbt test` + MCP tests green; `schemas/workspace-context.schema.json` documents the
      `truncated` marker.
- [ ] Backward-compat: default budget generous enough that small workspaces are unchanged;
      additive marker field only.

## Out of scope

- The Claude call itself and its own max-tokens guardrails (HEL-341 Claude-wiring ticket) — this
  ticket sizes the *input context*, not the model call.

## Dependencies

- Builds on all other HEL-345 tickets (it budgets their combined output). Consumed by HEL-341
  authoring endpoint.

---

## Carried finding this ticket owns: pagination truncation

List calls (`dataSources`/`dataTypes`/`dashboards`) use `Page.Default` (`limit = 200`,
`backend/src/main/scala/com/helio/domain/pagination.scala:11`) rather than the repo max of 500.
A workspace with >200 of a resource kind silently gets a truncated `items` array while `counts`
still reports the true total. HEL-371's final gate raised it and every subsequent ticket
explicitly deferred it here as "belongs to HEL-377." Decide it deliberately: raise the limit,
paginate properly, or keep the truncation but make it *explicit and self-describing* in the
payload so an agent knows it's seeing a subset. Silent truncation is the current bug; whatever is
chosen must not stay silent.

## Design-gate attention (from the orchestrator's brief)

- Determinism is the ticket's core requirement, not a nice-to-have — identical input must always
  produce identical output, no map-iteration-order dependence, no unstable sort, no set ordering
  leaking into the payload. Cross-language: Scala and TS must truncate identically.
- What gets dropped first is a real design decision — defend the priority order against the
  epic's purpose (an agent needs enough signal to pick a measure and a shape).
- Bound by construction, not by post-hoc trimming — prefer bounding upstream where possible.
- Do not silently degrade the guarantees the previous four tickets established — if a budget
  forces dropping statistics, the payload must say so.

## Carried findings from the epic (apply throughout)

1. `asNumeric` is structurally sound — reuse it, never re-patch/duplicate. Same for
   `roundToFourDecimals`/`BigDecimal.setScale`.
2. Guard invariants at terminal boundaries, not per-intermediate-step.
3. A finiteness guard is not automatically sufficient (e.g. `math.round(Double): Long` clamps
   `Infinity` to `Long.MaxValue`) — ask what happens *before* the guard.
4. Cross-language parity is tested, not assumed — both sides need equivalent regression coverage
   for anything new.
5. Confidently-worded but false documentation is this epic's most repeated failure — write only
   verified documentation, or state uncertainty explicitly.
6. `DataTypeRowRepository.listRows` runs on the PRIVILEGED pool (bypasses RLS) — owner scoping
   rests entirely on the app-layer `findByIdOwned` choke point. Verify by reading the call graph.
7. `Page.Default` = 200; both HikariCP pools are `maximumPoolSize = 5`. Pool bounds in-flight
   query memory, not retained results — raw rows must be consumed/released per DataType.
8. spray-json omits `Option = None` rather than `null`. Optional fields must not be in `$defs`
   `required`; or make the field always-present with an empty collection. Test the
   field-PRESENT branch too.
9. HEL-630 (known bug, filed): values whose plain-decimal expansion exceeds 100 chars throw on
   read. Avoid DB-backed tests with extreme numerics; prefer pure-unit specs.
10. HEL-631 (filed, do NOT act on): `WorkspaceContextService.scala` is ~706 lines, slated for a
    behavior-preserving split *after* this ticket. Don't refactor it here; a natural new file for
    new tests/logic is fine and preferred over growing the existing one further.
