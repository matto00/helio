# HEL-394: Smart shape: top-N (sort + limit by a measure, with ties policy)

## Context

Charts and tables frequently want the top (or bottom) N rows by a measure. The top-N shape
encapsulates sort + limit with an explicit ties policy. Built on the shape abstraction (HEL-391)
and the existing `sort`/`limit` ops in `backend/src/main/scala/com/helio/domain/steps/`.

## Scope

Backend:

- Register a `top-n` shape in `PipelineShape.Registry`. Params: `measure` (field), `direction`
  (desc/asc), `n` (count), and a `ties` policy (`strict` = exactly N via limit; document any
  `dense`/`keep-ties` variant and whether it needs the `window` op — if so, note it, but keep the
  default path sort+limit only). Output contract: at most N rows, same columns as input.
- Expansion → `sort` + `limit` step create-payloads. No new step kinds for the default path. No
  inline fully-qualified names.
- Extend the catalog + `schemas/`/`openspec/` as needed.

## Acceptance criteria

- [ ] The `top-n` shape appears in the catalog with params (measure, direction, n, ties) + output
      contract.
- [ ] `expand(params)` yields sort+limit; a run returns the correct top/bottom N rows.
- [ ] Ties policy behavior is documented; the default (strict limit) works; any keep-ties variant
      either works via `window` or is explicitly deferred.
- [ ] Tests: expansion → expected step list; end-to-end top-N run.
- [ ] Backward compatible: additive; no persisted schema change.

## Out of scope

- Panel wiring, MCP surface, editor UX (sibling tickets).
- Per-group top-N (needs the `window` op) unless trivially added — otherwise note as a follow-up.

## Dependencies

- Blocked by HEL-391 (shape abstraction, registry, catalog endpoint — merged, PR #288).
- Default path uses existing sort/limit ops; a keep-ties/per-group variant may relate to the
  `window` op (HEL-376 — merged, PR #281).

## Orchestrator pre-brief notes (not part of the ticket, carried context for planning)

- This is the SECOND concrete shape in the HEL-337 epic. HEL-393 (`single-row`, PR #289, commit
  `3d4b0c07`) is the primary template — mode-discriminated expansion, no new step kinds, registry
  is code-level (no Flyway migration).
- `RowCountContract.AtMostParam` has had no production consumer until now — top-N is its first
  real user; exercise its wire serialization explicitly in tests.
- Ties policy is a real design decision: define Nth/N+1th tie-break behavior deterministically.
  HEL-336's `window` op set the precedent of tie-breaking by original input index — `SortStep`'s
  underlying sort is already documented as stable, so ties are naturally broken by original row
  order; make this explicit and test it.
- Decide deliberately: global-only top-N vs. per-group (partitioned, needs `window`). If
  global-only, say so explicitly in the proposal and file a spinoff under HEL-337.
- Two non-blocking follow-ups from HEL-393's review, to resolve or spin off here:
  1. `fn`/`operator` validation in `SingleRowShape` is case-SENSITIVE while `combinator` is
     case-INSENSITIVE — a real inconsistency (compounded by `AggregateStep.apply` itself lowering
     `fn` before matching, so the validation layer is stricter than the runtime it guards). Fix
     inline if small and contained; spin off if it ripples.
  2. No HTTP-layer test asserts a *named* shape appears in the catalog response. Add one covering
     both `single-row` and `top-n`.
