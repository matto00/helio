# HEL-403: Patch-set proposal schema + protocol (N targeted edits across resources)

## Description

Conversational refinement — "make that a bar chart, group by month," "add a unit label," "drop
the last panel" — should apply *targeted patches* to existing resources, not rebuild them. The
existing propose/apply artifacts only *create* (`DashboardProposal` mints new dashboards +
panels). HEL-328 adds the MCP edit-in-place PATCH tools (source/type/pipeline/step) — the
mutation primitives. What's missing is a reviewable, multi-edit artifact: a **patch set**
describing N targeted edits across one or more resources, so a refinement can be previewed and
applied atomically.

This ticket defines that artifact: the patch-set schema + protocol. It is the foundation for the
diff-preview, atomic-apply, and undo tickets.

Touches: new `schemas/patch-set.schema.json`, a new protocol in
`backend/src/main/scala/com/helio/api/protocols/`, formatters in `JsonProtocols.scala`, and
alignment with the existing PATCH request shapes (`UpdatePanelRequest`/`UpdateDashboardRequest`,
panel `PanelPatchApplier`, and the HEL-328 source/type/pipeline/step PATCH shapes).

## Scope

* schemas: `schemas/patch-set.schema.json` (JSON Schema 2020-12). A patch set is
  `{ summary?, edits: [Edit] }` where each `Edit` targets a resource by kind + id and carries a
  typed partial update — e.g. `{ target: { kind: panel|dashboard|dataSource|dataType|pipeline|
  pipelineStep, id }, op: update|delete|create, patch: <partial> }`. Reuse the existing
  per-resource PATCH shapes for the `patch` body (panel appearance/config, dashboard
  layout/appearance, and the HEL-328 source/type/pipeline/step shapes) rather than inventing new
  ones.
* Backend Scala: `PatchSet` case classes + a tolerant `RootJsonFormat` (parity with
  `DashboardProposalProtocol`'s absent-optional tolerance). No fully-qualified names inline.
* Each edit references an EXISTING resource id (unlike the create-only dashboard proposal);
  creates within a patch set (e.g. add a panel) are allowed but clearly distinguished from
  updates.
* Tests: ScalaTest round-trip for a mixed patch set (panel update + panel delete + dashboard
  layout update); absent-optional tolerance; rejection of an edit with no target id for an update
  op.

## Acceptance Criteria

- [ ] `schemas/patch-set.schema.json` defines an ordered list of typed, resource-targeted edits
      (update/delete/create) reusing existing per-resource PATCH shapes.
- [ ] Backend `PatchSet` protocol round-trips the schema and tolerates omitted optionals.
- [ ] Edit targets reference existing resource ids for update/delete; create edits are
      distinguished.
- [ ] `sbt test` green with round-trip + validation tests.
- [ ] Backward-compat: additive schema + protocol; existing PATCH endpoints/shapes unchanged.

## Out of Scope

* Applying the patch set, diff/impact preview, and undo (sibling HEL-343 tickets that consume
  this contract).
* The MCP PATCH primitives themselves (HEL-328).

## Dependencies

* Blocked by HEL-328 (edit-in-place PATCH tools define the per-resource patch shapes this
  reuses) — already merged to main. Foundation for the HEL-343 apply, diff-preview, and undo
  tickets.
