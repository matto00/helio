## Context

`panels.metric_id REFERENCES metrics(id) ON DELETE SET NULL` (V76) already exists; no reverse-lookup
(metric → panels) exists anywhere. The exact pattern to mirror is `DataTypeService.delete` +
`DataTypeRepository.existsBoundToAnyOwnedPanel` (`backend/.../DataTypeRepository.scala:189-205`), which
blocks DataType delete when in-use — Metric delete instead unbinds (`SET NULL`), so this ticket needs a
*count/list* query, not a *block* check. `helio-mcp/src/context.ts`'s `buildWorkspaceContext` (HEL-549)
currently includes deprecated metrics unconditionally — its own doc-comment (lines 949-964) states this
was a deliberate prior decision, now being reversed. `MetricPicker.tsx`/`useMetricBindingState.ts`
(HEL-553) apply zero deprecated filtering anywhere in the fetch→store→render chain.
`DELETE /api/metrics/:id` returns bare `204 No Content` today (`MetricRoutes.scala:65-67`); the
frontend's delete-confirm (`MetricDetailPage.tsx`/`MetricListTable.tsx`) is an established inline
confirm-panel pattern (no `window.confirm` anywhere in this codebase), currently showing static,
hand-written copy with no real count.

## Goals / Non-Goals

**Goals:** owner-scoped "where used" query; deprecated metrics excluded from the grounding catalog and
picker defaults (existing bindings still resolve); delete communicates real impact before/at commit;
prove rename requires no re-binding.

**Non-Goals:** a standalone "usage list" UI page (the usage query is consumed only via the delete-confirm
hook point this ticket touches); a deprecated badge on the non-modal dashboard-grid panel card (editor
only — contains blast radius to surfaces this ticket already edits); MCP `delete_metric` tool changes
(the new header is additive/available, not required by any AC); `list_metrics` filtering (agents
actively managing metrics still need to see deprecated ones).

## Decisions

**D1 — New `GET /api/metrics/:id/usage` sub-resource route**, not folded into `GET /api/metrics/:id`.
Matches existing sub-resource precedent (`GET /api/pipelines/:id/analyze`, `GET /api/types/:id/rows`)
and avoids an N+1 cost on the list/get endpoints (which don't need usage data). Response:
`{ metricId, count, panels: [{ panelId, panelTitle, dashboardId, dashboardName }] }`. New
`MetricRepository` query joins `panels`/`dashboards` the same way `PanelRepository.findById`
(`PanelRepository.scala:114-155`) already joins them (`panel <- table if ...; dash <- dashTable if
dash.id === panel.dashboardId`), filtered by `metric_id = <id> AND owner_id = <caller>` — the same
owner-scoping shape as `existsBoundToAnyOwnedPanel`. 404 via `findByIdOwned` first (matches every other
per-id metric route).

**D2 — `DELETE /api/metrics/:id` stays `204`; the count travels in an additive
`X-Unbound-Panel-Count` response header, not a body.** Alternative considered: change the success
response to `200` with a JSON body (`{deleted: true, unboundPanelCount: n}`) — rejected because it's a
breaking wire-contract change to an already-shipped, already-consumed endpoint (the frontend
`deleteMetric` service call and a future/hypothetical MCP `delete_metric` body-reader would both need
to change in lockstep, for no functional gain over a header, since neither consumer needs the count
synchronously from the DELETE call itself — see D3). A header is purely additive: existing consumers
that ignore it are unaffected, satisfying "the delete response communicates the affected count"
literally without a breaking change. Computed by the same usage-count query as D1, run inside
`MetricService.delete` just before the repository delete.

**D3 — The frontend delete-confirm flow gets its count from `GET .../usage` (D1), called when "Delete
metric" is first clicked** — not by parsing the DELETE response header. This is what makes the impact
"communicated first" (before the user commits), matches the ticket's literal wording, and reuses the
richer, already-JSON D1 endpoint rather than requiring axios header-parsing for a value the UI needs
*before* the destructive call, not after it. The DELETE header (D2) remains for other/future consumers
that skip the pre-check.

**D4 — `buildWorkspaceContext`'s `metrics` array filters `deprecated !== true` unconditionally** (no
opt-in param) — matches the ticket's absolute phrasing ("excluded from the agent grounding catalog").
Update the stale doc-comment (lines 949-964) in the same change. `list_metrics` (`GET /api/metrics`
passthrough) is untouched — it's the tool an agent uses to actively manage/un-deprecate metrics, so it
must still show them.

**D5 — `MetricPicker`'s offered options exclude `deprecated: true` metrics, except the panel's
currently-bound metric (if deprecated) stays visible/selectable.** Filtering happens in
`useMetricBindingState.ts` (before `MetricPicker` ever sees the list), computed as `metrics.filter(m =>
!m.deprecated || m.id === currentMetricId)` — so a user can see what a panel is bound to and choose to
change it, but can't newly pick a deprecated one.

**D6 — A new, conditionally-computed `metricDeprecated: Boolean` read-time field**, independent of the
existing raw-vs-materialized value precedence (design differs from `dataTypeId`/`fieldMapping`/etc.,
which materialize only when the raw field is unset — `deprecated` status is informational, not a bindable
value, so it always reflects the metric's current state whenever `metricId` resolves). Added alongside
the existing `withMaterializedMetric` resolution (`PanelServiceHelpers.scala:269-287`) for all three
metric-capable panel types (`Metric`/`Chart`/`Table`), even though only `Metric` materializes the other
fields — `deprecated` awareness applies regardless of materialization scope, since a chart/table panel
can be bound to a deprecated metric too. The field is emitted if and only if `metricId` is present and
resolves to an owned `MetricDefinition` — it is absent (not `false`) on an unbound panel or one bound
only via raw `dataTypeId`/`fieldMapping`, which is the majority case both today and after this change.
`schemas/panel.schema.json`'s `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` (each
`"additionalProperties": false`) MUST declare `metricDeprecated: boolean` in `properties` — with no
`required` change at the `$def` level, since those `$def`s are shared: `create-panel-request.schema.json`
also `$ref`s them to validate `POST /api/panels`, where `metricId` is a valid client-supplied create
field but `metricDeprecated` is read-only/server-materialized and must never be required of a client.
The conditional requirement instead lives in `panel.schema.json`'s own top-level `oneOf` — its
`metric`/`chart`/`table` branches combine the `$def` `$ref` with an `allOf`/`if`/`then` block
(`"if": {"required": ["metricId"]}, "then": {"required": ["metricDeprecated"]}`), mirroring
`schemas/create-panel-request.schema.json`'s existing `allOf`/`if`/`then` pattern but scoped to
response-only validation, not the cross-file-shared `$defs`. (Round-1 design-gate REFUTE: the schema
update was originally missing entirely. Round-2 REFUTE: the first fix specified an unconditional
`required`. Round-3 REFUTE: the second fix specified the right conditional but at the wrong scope —
inside the shared `$defs` rather than `panel.schema.json`'s own response-only `oneOf`. All three are
now corrected here and in tasks.md 2.3, confirmed by an over-budget round-4 skeptic re-verification per
explicit human sign-off — see Planner Notes.) `schemas/bound-panel-response.schema.json` inherits the
fix for free via its existing `$ref` to `panel.schema.json`. For the same D1-precedent reason,
`schemas/metric-usage-response.schema.json` is added for the new `GET /api/metrics/:id/usage` response
shape (tasks.md 1.3), even though not every existing sub-resource endpoint has one — kept for internal
consistency with the precedent this change itself cites.

**D7 — The deprecated badge is duplicated into the panel-binding-editor's own CSS, not promoted to a
shared component.** Only two consumers exist after this change (`MetricListTable.tsx`,
`MetricBindingFields.tsx`/`MetricPicker.tsx` area) — matches this codebase's established "rule of
three" extraction convention (HEL-553's own `fieldOptions.ts` comment cites it explicitly). Promote to
`shared/ui/` only if a third consumer appears.

**D8 — Rename safety is test-only**, no production code changes. `resolveSingleBinding`/
`resolveBindingsForRead` already read the *current* `MetricDefinition` on every materialization call
(D6's neighbor code), so a `PATCH /api/metrics/:id` name change is reflected on every subsequent panel
read with zero additional work — add a `MetricRepositorySpec`/`PanelMetricBindingRoutesSpec`-style test
proving it, not a design change.

## Risks / Trade-offs

- [D1's join query duplicates `PanelRepository.findById`'s join shape rather than reusing a shared
  helper] → acceptable; the existing join isn't currently factored for reuse across repositories, and
  introducing that abstraction now would be a larger, riskier refactor than this ticket needs.
- [A header-based count (D2) is less discoverable to an API consumer that doesn't know to look for it]
  → mitigated by D3: the primary UX path (frontend delete-confirm) never depends on the header at all;
  the header exists for completeness, not as the primary communication channel.
- [D4 changes already-shipped, already-documented HEL-549 behavior] → explicitly flagged, not silent;
  the doc-comment update in the same commit keeps the code and its own documentation in sync.

## Planner Notes

Self-approved: D1 (sub-resource precedent, not a new pattern), D2/D3 (resolved what could have been a
breaking-API-change escalation into a non-breaking additive design — see D2's rejected alternative),
D4/D5 (both explicitly required by the ticket's own text, scoped to exactly what's asked), D6/D7
(mechanical extension following two already-established codebase conventions), D8 (test-only, no
design risk). None of these introduce new external dependencies or scope beyond the ticket's own text.

Round 1 design-gate REFUTE (`skeptic-design-1.md`): the one required revision (D6's missing
`schemas/panel.schema.json` contract update) addressed above; the one non-blocking suggestion
(`schemas/metric-usage-response.schema.json`) also addressed, for consistency with D1's own cited
precedent.

Round 2 design-gate REFUTE (`skeptic-design-2.md`): the round-1 fix itself specified an incorrect
unconditional `required` entry for `metricDeprecated`; corrected to the conditional `allOf`/`if`/`then`
pattern (mirroring `create-panel-request.schema.json`'s existing use of the same construct), matching
the field's actual conditional-emission semantics.

Round 3 design-gate REFUTE (`skeptic-design-3.md`): the round-2 fix placed the conditional in the
shared `$defs`, also consumed by `create-panel-request.schema.json` for create-time validation — moved
to `panel.schema.json`'s own top-level `oneOf` (response-only scope) instead. This exhausted
`SKEPTIC_DESIGN_ROUNDS` (3); escalated per protocol. Human resolution (chat, since the dashboard
`--await` timed out): apply this exact fix and spend one explicitly-approved over-budget round-4
skeptic re-verification before proceeding to execution, rather than trusting the diagnosis alone on an
unattended run — not a reopened design question, a requested confirmation step.
