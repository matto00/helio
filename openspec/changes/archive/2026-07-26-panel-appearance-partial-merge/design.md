## Context

`PATCH /api/panels/:id` (`PanelServiceHelpers.normalizeAppearancePayload`, used by `resolvePatch`) builds a
**fresh** `PanelAppearance` from `RequestValidation.normalize*` calls, each of which defaults an absent
`Option` field to a hardcoded constant (`"transparent"`, `"inherit"`, `0.0`) rather than the panel's stored
value — full replace, not merge. `PanelPatchApplier.applyAppearance` just persists whatever
`ResolvedPanelPatch.appearance` carries.

The batch path (`PanelMutationRepository.batchUpdate`) is **not** identically broken: it already does an
ad hoc top-level merge (`ap.background.getOrElse(current.background)`, ...,
`ap.chart.orElse(current.chart)`) directly against the stored row. Its actual gap is narrower: `chart` is
all-or-nothing (`.orElse`, no merge into the sub-object) and — because `PanelAppearancePayload`'s wire
format (`jsonFormat4`) decodes through `ChartAppearance`'s own format, which requires all 4 non-`chartType`
fields — a payload carrying only `{"chart": {"chartType": "bar"}}` fails JSON decoding before either path
ever sees it (surfaces as 400). Both paths need the same fix; single is currently worse (drops
`background`/`color`/`transparency` too), batch is narrower (chart-only).

The central blocker for both: spray-json's macro-generated `Option` formats collapse "field absent" and
"field explicitly `null`" to the same `None` on read, so `PanelAppearancePayload`'s current
`jsonFormat4(PanelAppearancePayload.apply)` cannot distinguish them at any field, top-level or nested.

Prior art already solves exactly this problem in this codebase: `MetricPanelConfig.Patch` (and every other
subtype's `*Config.Patch`) decodes directly from the raw `JsObject`, using the `Option[Option[T]]` idiom
(outer `None` = absent/keep, `Some(None)` = explicit null/clear, `Some(Some(v))` = set), and is threaded
through as a raw `config: JsValue` on `UpdatePanelRequest`/`PanelBatchItem`, decoded at apply time by
`PanelConfigCodec.applyConfigPatch`. This design reuses that exact idiom and wire shape for `appearance`.

## Goals / Non-Goals

**Goals:**
- Single-item and batch appearance PATCH both merge: absent fields preserve the stored value.
- Partial `chart` payloads (e.g. `{"chartType": "bar"}` alone) are accepted and merge over the stored
  `ChartAppearance` (or `ChartAppearance.Default` when none stored).
- `chartType` validation (`RequestValidation.validateChartType`) still rejects invalid values with 400,
  on both paths.
- Create-time appearance (`resolveCreateAppearance`) is untouched — still builds from `PanelAppearance.Default`.
- A full `PanelAppearance`/`ChartAppearance` payload (what every existing client sends today) merges to an
  identical result as today's replace (backward compatible).

**Non-Goals:**
- Deep-merging inside `legend`/`tooltip`/`axisLabels` (e.g. changing only `legend.position`, leaving
  `legend.show` stored). The acceptance criteria only require chart-level field granularity
  (`seriesColors`/`legend`/`tooltip`/`axisLabels`/`chartType` each independently settable, replaced
  wholesale when provided) — going deeper adds real complexity (5 more nested Patch types) for a case no
  caller has hit. If this bites in practice, it's a small, isolated follow-up.
- Dashboard appearance PATCH (see Decision 5).
- A dedicated clear/reset UI gesture — explicit-null is a wire contract detail only.

## Decisions

**1. Wire shape: `appearance` becomes raw `JsValue` on `UpdatePanelRequest`/`PanelBatchItem`, decoded at
apply time — mirroring `config`.**
`PanelProtocol.updatePanelRequestFormat`/`panelBatchItemFormat` already special-case `config` as a raw
`JsValue` passthrough for exactly this reason (per-subtype `Patch.decode` needs the original JSON to see
key presence). `appearance` gets the same treatment: `UpdatePanelRequest.appearance: Option[JsValue]`,
`PanelBatchItem.appearance: Option[JsValue]`. `CreatePanelRequest.appearance` is untouched
(`Option[PanelAppearancePayload]`, still `jsonFormat4` — create never needs absent-vs-null since every
field falls back to a default regardless).
Alternative considered: keep `PanelAppearancePayload` and add a second `Option[Option[T]]`-shaped payload
type in `PanelProtocol.scala` with custom field-by-field spray-json read logic. Rejected — the domain-layer
`Patch` idiom already exists, is proven, and keeps decode logic colocated with the merge logic that
consumes it (as `MetricPanelConfig.Patch` does), rather than splitting parsing (protocols) from semantics
(domain) for no benefit.

**2. New domain types: `PanelAppearance.Patch` and `ChartAppearance.Patch`, in `domain/model.scala`
next to `PanelAppearance`/`ChartAppearance`.**
Each field is `Option[Option[T]]`. `PanelAppearance.Patch.decode(json: JsValue): Patch` reads the raw
`JsObject`, mirroring `MetricPanelConfig.Patch.decode`'s per-field `match { case None ... case Some(JsNull)
... case Some(validShape) ... case Some(x) => deserializationError(...) }`. `chart` decodes to
`Option[Option[ChartAppearance.Patch]]` (not `Option[Option[ChartAppearance]]`) — the one place this
design goes beyond the `MetricPanelConfig.Patch` precedent, because `chart` itself needs field-level
partial merge, not wholesale replace.
`PanelAppearance.applyPatch(patch: Patch, existing: PanelAppearance): PanelAppearance` and
`ChartAppearance.applyPatch(patch: ChartAppearance.Patch, existing: ChartAppearance): ChartAppearance`
fold each field: absent → keep `existing`'s value; explicit null → reset to
`PanelAppearance.Default`/`ChartAppearance.Default`'s corresponding value (see Decision 3); set → use the
provided value (chart's `chartType` still passes through `RequestValidation.validateChartType` before
`applyPatch` is called, at decode time, matching today's validation point).
Decode failures (malformed shapes — e.g. `"chart": "nope"`) surface as `DeserializationException`, caught
by a `safe { }` wrapper (mirrors `PanelConfigCodec.safe`) that turns it into `Left(message)` → 400. This is
the same three-line pattern already in `PanelConfigCodec.scala`; duplicated rather than shared because it's
three lines and the two call sites (config, appearance) are independent enough not to warrant an extracted
helper for this ticket's scope.

**3. Explicit-null semantics: reset to `PanelAppearance.Default`/`ChartAppearance.Default`, not "out of
scope."** Trivially available for free from the `Patch` idiom (no extra work over supporting absent-only),
so it's implemented and tested, not punted. `background: null` → `"transparent"`; `chart: null` → clears
the chart sub-object entirely (`None`) — the natural "revert to un-customized" gesture. Inside a provided
`chart` patch, `chartType: null` → `None` (matches today's "absent chartType renders as line" fallback);
`legend: null` → `ChartAppearance.Default.legend`, etc. This mirrors `MetricPanelConfig.Patch`'s own
null-clears-to-a-defined-empty-state convention (there, `DataTypeId("")`/`JsObject.empty`; here, the
`Default` singleton already used by every other "no value provided" path in this file, so it's the most
consistent choice available, not a new convention).

**4. Merge logic lives in `PanelServiceHelpers`/`PanelService`, not `PanelPatchApplier`.**
The ticket's scope text suggested threading the stored appearance into `PanelPatchApplier.applyAppearance`.
Deviating: `PanelServiceHelpers.resolvePatch(request: UpdatePanelRequest, existing: Panel)` **already**
receives `existing` — the merge can happen there, producing a fully-resolved `PanelAppearance` on
`ResolvedPanelPatch` exactly as today. `PanelPatchApplier` stays a dumb "persist an already-resolved value"
layer (its own doc comment: "Applies a validated patch... by composing per-field repository updates") —
no changes needed there at all. Batch gets the identical merge call (`PanelAppearance.applyPatch`) inside
`PanelMutationRepository.batchUpdate`, replacing its current hand-rolled `getOrElse`/`orElse` block, against
`rowToDomain(row).appearance`.

**5. Dashboard appearance PATCH (`DashboardServiceValidation.normalizeAppearance`) has the identical bug —
scoped OUT to a spinoff, not fixed here.** Confirmed: `normalizeAppearance` rebuilds `DashboardAppearance`
from `RequestValidation.normalizeDashboardBackground/GridBackground`, both of which default an absent field
to a hardcoded constant exactly like the panel path did. Scoping out because: (a) the ticket's acceptance
criteria, test list, and "Out of scope" section are 100% panel-focused — dashboards were never in the
original ask; (b) it's a materially smaller, structurally simpler surface (2 flat string fields, no nested
`chart`-equivalent) that doesn't share code with the panel fix and doesn't block it; (c) keeping this
ticket's diff scoped to its stated acceptance criteria keeps risk contained on the epic's highest-value,
most-production-sensitive item. Filed as a spinoff (Linear, parented under HEL-344) rather than silently
dropped.

**6. Top-level `"appearance": null` (the whole field, not a field inside it) is a no-op, not a
wipe.** `Patch.decode` mirrors `MetricPanelConfig.Patch.decode`'s own `case _ => Empty` fallback for
non-`JsObject` input — `JsNull` at the top level decodes to `Patch.Empty` (every field absent), so
`applyPatch` returns `existing` unchanged. This is a deliberate, explicit decision (not an oversight):
resetting the *entire* appearance to `PanelAppearance.Default` on a bare top-level `null` would be a
much bigger, more surprising blast radius than any single-field `null`-clear, is not requested by any
acceptance criterion, and has no existing caller depending on it. Same rule applies to the batch item's
`appearance` field. Documented in the spec so it isn't silently dropped.

**7. Schema: new `schemas/panel-appearance-patch.schema.json` (all fields optional, incl. nested `chart`
fields), referenced by `update-panels-batch-request.schema.json`'s `appearance` property.**
`schemas/panel-appearance.schema.json` (full-object, `required: [background, color, transparency]`) stays
as-is and continues to back `create-panel-request.schema.json` only — create's contract is unchanged.
There's no existing schema file for the single-item `PATCH /api/panels/:id` body (spec-documented, not
JSON-Schema-validated at runtime — `PanelRoutes.scala` has no schema-validation call), so no update needed
there beyond the `panel-appearance-settings` capability spec text.

## Risks / Trade-offs

- **[Risk]** A caller currently relying on "omit `chart`" behaving as "wipe stored chart" (today's replace
  bug) would see a behavior change. → Mitigation: no known caller depends on the bug (it's the ticket's
  entire premise — frontend/helio-news/MCP all *fight* this behavior today); proposal.md documents this as
  the intended, in-scope breaking-of-a-bug.
- **[Risk]** Batch's existing hand-rolled merge is replaced wholesale — regression risk on a code path with
  its own prior HEL-296 bug history (dropped `aggregation` column). → Mitigation: ScalaTest coverage for
  the batch path is an explicit acceptance criterion; run the full existing `PanelMutationRepositorySpec` /
  batch-update suite, not just new tests.
- **[Trade-off]** Chart-level merge only (not deep into `legend`/`tooltip`/`axisLabels`) means a caller
  wanting to flip only `legend.show` must still resend all of `legend`. Accepted per Non-Goals — matches
  the literal acceptance criteria and avoids five more nested `Patch` types for an unrequested case.

## Planner Notes

- Self-approved: explicit-null-clears-to-Default semantics (Decision 3) — ticket left this an open
  decision ("out of scope unless trivially supported"); it's trivially supported by the chosen idiom, so
  implementing it is the more useful and more consistent choice, not scope creep.
- Self-approved: merge logic placement in `PanelServiceHelpers`/`PanelService` rather than
  `PanelPatchApplier` (Decision 4) — an implementation-detail deviation from the ticket's suggested file,
  not from its actual requirement (merge instead of replace), and it fits the codebase's existing
  architectural boundary between "resolve" and "apply" more cleanly.
- Self-approved: dashboard appearance PATCH scoped to a spinoff, not this ticket (Decision 5) — ticket
  pre-brief explicitly delegated this decision to the design gate.
