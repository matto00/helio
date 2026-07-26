## Context

Panel binding today has exactly one server-enforced rule beyond auth: `PanelService.rejectCompanionBinding`
400s when `dataTypeId` resolves to a DataType with `sourceId` set (V41, pipeline-outputs-only). There is
**no backend validation of `fieldMapping` slot names or column-type fit** — `ChartPanelConfig`/`MetricPanelConfig`/
etc. all decode `fieldMapping` as an opaque `JsObject` (`ChartPanel.scala:208`, `MetricPanel.scala:32`).
The slot contract (`metric → {value,label?,unit?}`, `chart → {xAxis,yAxis,series?,annotation?}`,
`timeline → {time,event}`, `collection → base-type slots`, `table → none`) exists only as prose in
`helio-mcp/src/tools/write.ts` (`bind_panel`) and as a parallel TS map in `frontend/src/features/panels/state/panelSlots.ts`.
This ticket must not invent a *third* copy of that contract that drifts from the two that already exist.

## Goals / Non-Goals

**Goals:**
- One backend definition of "slots per panel kind" (`PanelBindingSpec`), consumed by the new endpoint, with
  a test that cross-checks its slot key sets against `bind_panel`'s documented contract and `panelSlots.ts`
  (parsed as data, not duplicated by hand) so the three can't silently diverge.
- Column-type eligibility per slot (numeric for `value`/`yAxis`, timestamp/orderable for `time`, any for
  the rest) grounded in how each panel actually renders its bound field, not a fabricated new rule.
- Reflect HEL-292: metric/chart/collection eligibility depends on "has ≥1 numeric column", not row count.
- Owner-scoped 404 (never a 403 tenant-existence leak) for the DataType lookup, mirroring `DataTypeService.findById`.

**Non-Goals:** editorial "worth showing" judgement, chart sub-shape recommendation, aggregation planning,
touching `frontend/` (this is a server + MCP surface), absorbing HEL-364/370/366/367/368.

## Decisions

**D1 — Two different questions, not one duplicated.** HEL-399's `panelShapes.ts` answers "which pipeline
*shape catalog entries* are a good starting point to build a NEW metric-bound DataType" — a curated,
opinionated map used only inside the shape-picker step of panel creation. This ticket answers "given a
DataType that already exists, what CAN it structurally bind to" — exhaustive, not curated, and independent
of how the DataType was produced. `panelShapes.ts`'s `metric → single-row` entry is a *recommended shape*,
not a claim that metric can't bind multi-row data; it predates nothing and isn't stale — it's just scoped to
authoring-time suggestion, not bind-time capability. No shared code between the two: one is a frontend
UI-authoring heuristic, the other is a backend runtime fact. Documented here so a future reader doesn't
"fix" one to match the other.

**D2 — `PanelBindingSpec` is the new canonical *slot* contract; column-type eligibility is a documented
heuristic, not an enforced validator.** Because the backend does not validate `fieldMapping` column fit
today (D-context), this endpoint cannot claim to mirror an enforcement path that doesn't exist for that
part. What it *can* and does mirror exactly is V41 (a real, enforced rule) and the slot *names* (real,
documented in two other places). `PanelBindingSpec` per `PanelType` — `(requiredSlots, optionalSlots,
columnEligibility: SlotKey => DataFieldType => Boolean)` — lives in `domain/panels/PanelBindingSpec.scala`,
one object, no per-endpoint duplicate. Column-type rules: `value`/`yAxis` → numeric (`integer`/`float`);
`time` → orderable (`timestamp`/`integer`/`float`); everything else (`label`,`unit`,`xAxis`,`series`,
`annotation`,`event`,`content`) → any column.

`panelSlots.ts`'s `PANEL_SLOTS` map has no required/optional distinction and is *not* a complete slot
inventory to diff wholesale against — verified by reading its actual consumers, not just the map:
- `chart: [xAxis, yAxis, series]` (used by `FieldMappingSlots` via `BindingEditor.tsx:331`) omits
  `annotation` on purpose: the reserved `annotation` slot is merged in separately outside the generic
  slot loop (`BindingEditor.tsx:245-259`), confirmed by `schemas/panel.schema.json:95` and
  `helio-mcp/src/tools/write.ts:439-440`. It is a real slot the generic map doesn't enumerate, not a
  drift bug.
- `metric: [value, label, unit]` is not read by `MetricPanel`'s own editor (`FieldMappingSlots.tsx`'s own
  comment: "metric no longer uses this ... see BindingEditor"). Correction from round-1 review:
  `CollectionEditor.tsx` does **not** actually import `PANEL_SLOTS` — its line-35 doc comment claims the
  item slots are "derived from `PANEL_SLOTS.metric`" but the `value`/`label`/`unit` keys are hardcoded
  independently (`CollectionEditor.tsx:55-57,114-116`). The doc comment and the real map agree today by
  coincidence, not by wiring — a future edit to `PANEL_SLOTS.metric` would not propagate here. So
  `PanelBindingSpec.collection`'s cross-check target is the literal hardcoded key set
  `{value, label, unit}` transcribed from `CollectionEditor.tsx:55-57`, not `PANEL_SLOTS.metric` — and the
  same target happens to equal `PanelBindingSpec.metric`'s slots, so that self-consistency assertion still
  holds, just for a different, correctly-cited reason.
- `timeline: [time, event]` (used by `TimelineEditor.tsx:113`) matches exactly, both required.
- `table: []` matches exactly (no slots).

So the ScalaTest (`PanelBindingSpecSpec`) cross-checks three things, each against what's actually true, not
a blanket diff: (a) `PanelBindingSpec.chart`'s required∪optional set **minus** `annotation` equals
`{xAxis,yAxis,series}` (from `panelSlots.ts`, live-wired via `BindingEditor.tsx:331`); (b)
`PanelBindingSpec.timeline`'s required set equals `{time,event}` exactly (from `panelSlots.ts`, live-wired
via `TimelineEditor.tsx:113`); (c) `PanelBindingSpec.collection`'s required/optional sets equal
`PanelBindingSpec.metric`'s AND both equal the hardcoded `{value, label, unit}` in `CollectionEditor.tsx`
(not `PANEL_SLOTS`-wired — see the correction above; this leg checks the two independent hardcodings agree,
not that one derives from the other). The comparison values are literal Scala constants transcribed at
write time (a snapshot, not a live TS parser), each commented with the frontend file:line it mirrors so a
future maintainer updates both sides together instead of "fixing" one to match the other.

**D3 — Bindability per kind = `isPipelineOutput && hasRequiredSlotColumns`.** `metric`/`collection` require
≥1 numeric column (`value`, post-HEL-292 — no row-count gate). `chart` requires ≥1 numeric column (`yAxis`)
and ≥1 column total (`xAxis`, may reuse the numeric column). `timeline` requires ≥1 orderable column
(`time`) and ≥1 column total (`event`, may reuse). `table` has no slots and is bindable whenever
`isPipelineOutput` — matches `bind_panel`'s "table — no fieldMapping needed". A companion DataType
(`sourceId.isDefined`) is `bindable: false` for all five kinds with a machine-checkable
`reason: "not-pipeline-output"` code plus a `message` field carrying the exact literal string
`PanelService.rejectCompanionBinding` uses today — `"Panels can only bind to pipeline-output data types"`
(`PanelService.scala:306`) — so the response is traceable to the real rejection text instead of a
paraphrase invented for this endpoint.

**D4 — Chart-type honesty (pie/scatter aggregation gap, HEL-624).** The response reports `chart` as one
bindable kind (it does not enumerate bar/line/pie/scatter — the ticket's own non-goal: "recommending chart
sub-shape ... stays with the agent"). It never emits an `aggregation`-capability claim at all — aggregation
planning is explicitly out of scope (proposal "Non-goals"), so HEL-624's bar/line-only gate never enters
this response's vocabulary. No caveat text needed because no promise is made either way; noting this here
so a reviewer confirms the gap is avoided by omission, not by an unstated assumption.

**D5 — Multi-tenancy.** `PanelCapabilityService` calls `dataTypeRepo.findByIdOwned(id, user)` exactly like
`DataTypeService.findById` — `None` (not found for this owner, including cross-tenant) → 404, never a 403.
A new ScalaTest binds a DataType as user A, requests capabilities as user B, and asserts 404.

**D6 — Route shape.** `GET /api/types/:id/panel-capabilities` as a new path segment under the existing
`pathPrefix("types")` block in `DataTypeRoutes.scala` (mirrors the existing `.../rows` and
`.../validate-expression` sub-paths) — not a new top-level router, since it's DataType-scoped and small.
Logic lives in `PanelCapabilityService` (separate file — `DataTypeService` stays CRUD-only per its own
doc comment), called from `DataTypeRoutes`.

## Risks / Trade-offs

[Column-eligibility heuristic could imply stricter enforcement than exists] → D2 states explicitly in the
Scaladoc on `PanelBindingSpec` and in the route's response that eligible-columns are advisory, not a bind-time
guarantee — a bind with a "wrong" column still succeeds today (no backend validator exists to reject it).
[`panelSlots.ts` cross-check uses transcribed Scala constants, not a live parse] → a silent frontend edit to
`panelSlots.ts` doesn't fail this Scala test automatically; mitigated by commenting the transcribed
constants with the exact file:line consumers (D2) so a reviewer touching either side sees the pointer, and
by scoping the comparison to the three concrete, verified facts in D2 rather than the whole map (nothing
to silently miss).

## Planner Notes

Self-approved: endpoint added under `DataTypeRoutes` rather than a new `PanelCapabilityRoutes` file — the
ticket suggested "mirror DataTypeRoutes.scala" as a new file, but the existing file already hosts
DataType-scoped sub-resources this small (`/rows`, `/validate-expression`) and splitting one more one-route
file out is unnecessary indirection for ~60 lines of route glue. Service logic is still isolated in its own
file (`PanelCapabilityService`) per the ticket's "logic in a service" instruction.
