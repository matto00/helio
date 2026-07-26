# HEL-623: Delete OutputFieldContract from the shape output contract (YAGNI — zero consumers)

## Context

`OutputContract` (added in HEL-391, `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`) carries three parts: `rowCount`, `fields: Vector[OutputFieldContract]`, and `description`. `fields` **has zero producers and zero consumers.**

Across the entire completed HEL-337 epic — the registry (HEL-391), all four concrete shapes (HEL-393 single-row, HEL-394 top-n, HEL-396 time-series, HEL-398 pivot-matrix), the reference `passthrough` shape, and all three surfaces (HEL-402 editor UX, HEL-400 MCP, HEL-399 panel wiring) — every shape declares `fields = Vector.empty` and nothing ever reads it.

It cannot be populated as designed: `outputContract` is a static `val` with no access to `params`, so the shapes whose fields ARE derivable from params (single-row in aggregate mode, time-series) structurally cannot express them. `TimeSeriesShape` worked around this by describing its real field list in the prose `description` string instead.

The user reviewed the options (make it param-aware / delete it / leave it) and **decided against making it param-aware**: HEL-399 binds panels via the runtime DataType schema after instantiate → run, which is how binding already works, so static field contracts solve a problem the epic does not have.

This mirrors HEL-391's own design-gate decision to drop the speculative `OutputFieldContract.role` field for exactly this reason — no tested consumer need.

## Scope

* Remove `OutputFieldContract` and the `fields` member from `OutputContract`, leaving `rowCount` + `description` (the parts carrying real information — `rowCount` is genuinely consumed by HEL-399's shape/panel-kind matching).
* Update all five registered shapes (`passthrough`, `single-row`, `top-n`, `time-series`, `pivot-matrix`) to drop the now-removed argument.
* Update the catalog wire format and `schemas/pipeline-shape-catalog.schema.json`, plus the `openspec/specs/pipeline-shape-registry/spec.md` capability spec.
* Check the MCP surface (`helio-mcp/`) and the frontend shape-picker/instantiate flows for any reference to `fields` in a catalog response type, even if unused.
* Behaviour-preserving: no shape's expansion, validation, or output changes.

## Acceptance criteria

- [ ] `OutputFieldContract` no longer exists; `OutputContract` is `rowCount` + `description`.
- [ ] All five shapes compile and their existing tests pass unchanged.
- [ ] Catalog endpoint response, its JSON schema, and the capability spec agree with the new shape.
- [ ] No consumer (backend, MCP, frontend) references the removed field.

## Note

If a future surface genuinely needs static output columns, re-add it deliberately as a param-aware `outputContract(params)` — do not resurrect the static-`val` form that could never be populated.

## Additional orchestrator briefing (not part of ticket, for context)

- This is a behavior-preserving structural deletion. No opportunistic redesign. Every existing shape test should pass unchanged; if a test needs editing beyond dropping the removed argument, stop and ask why.
- `rowCount` stays and is genuinely used — HEL-399's panel-creation flow matches shapes to panel kinds off it (`ExactlyOne` -> metric, etc.). Do not touch it. `description` stays too.
- Sweep for consumers rather than assuming the ticket's list is complete: the domain model, the catalog protocol/serialization, `schemas/pipeline-shape-catalog.schema.json`, `openspec/specs/pipeline-shape-registry/spec.md`, `helio-mcp/` types (HEL-400 added a catalog snapshot to `buildWorkspaceContext`), and the frontend shape-picker/instantiate flows (HEL-402 and HEL-399). A stale reference in a TypeScript response type will not fail the Scala build.
- Watch for wire-format drift: the catalog endpoint's response shape changes, so the JSON schema, the capability spec, and any MCP/frontend type must all move together. This repo has a schema-drift check — make sure it passes.
- Design-gate note: this is a small deletion; if the design gate wants to relitigate whether to delete at all, that decision is already made by the user — record it and move on. A round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is not new grounds for escalation — continue.
