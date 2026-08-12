# HEL-560: Metric reuse governance — deprecation + safe rename/delete

## Description

Once metrics are reused across many dashboards (via 418-C `metricId` bindings), renaming, deprecating,
and deleting them needs to be SAFE and observable. Because panels reference a metric by id (not by
copied value), a rename propagates for free — but the user needs to understand impact before deleting
or deprecating, and deprecated metrics should stop being offered to the agent and the panel picker
while existing bindings keep working.

Builds on 418-C (HEL-500: Panel binding to a metric (metric -> panel)) which already makes metric
delete unbind panels via `ON DELETE SET NULL`.

## Scope

- Reference counting: add a "where used" read — given a metric, list the panels (and their dashboards)
  currently bound to it. New service method + a `GET /api/metrics/:id/usage` route (or fold into
  `GET /api/metrics/:id`). Owner-scoped.
- Deprecation semantics: a `deprecated == true` metric is excluded from the agent grounding catalog
  (418-E) and the panel metric picker's default list (418-F), but existing bindings continue to resolve
  normally at read time. Surface a "deprecated" indicator on panels bound to a deprecated metric.
- Safe delete: deleting a metric with live bindings returns the usage count in a confirmable way (the
  delete still succeeds and unbinds via `ON DELETE SET NULL` from 418-C, but the API/UX communicates the
  impact first). Renaming is inherently safe (id-referenced) — add a test asserting bound panels reflect
  the new name without re-binding.
- No FQNs inlined in Scala.

## Acceptance Criteria

- [ ] A "where used" query returns the panels + dashboards bound to a given metric, owner-scoped
      (ScalaTest).
- [ ] A renamed metric is reflected on all bound panels with no re-binding (ScalaTest over the resolve
      path).
- [ ] A deprecated metric is excluded from the grounding catalog and the picker's default list, while
      existing bindings still resolve (test).
- [ ] Deleting a metric with live bindings unbinds affected panels (`SET NULL`) and the delete response
      communicates the affected count.
- [ ] `sbt test` passes; no FQNs inlined.

## Out of Scope

- The metric authoring UI itself (418-F, shipped as HEL-553) — this ticket supplies the usage/
  deprecation semantics it surfaces.

## Dependencies

- Blocked by 418-C (HEL-500, shipped). Coordinates with 418-E (grounding excludes deprecated — the
  MCP/`get_workspace_context` side shipped as HEL-549) and 418-F (picker excludes deprecated, shows
  usage — shipped as HEL-553). Both HEL-549 and HEL-553 currently only FLAG `deprecated` (include it
  as a field) rather than EXCLUDING a deprecated metric by default — this ticket changes that.
