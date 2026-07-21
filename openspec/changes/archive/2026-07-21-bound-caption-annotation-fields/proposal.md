## Why

HEL-318 shipped **static free-text** captions (image) and annotations (chart). The follow-on need is a
**dynamic** source: let a chart's annotation come from a bound DataType field so it updates as the data
does (e.g. an "as of" value or a designated annotation column in a single-row DataType). Chart panels are
already bound, so this is tractable by reusing existing binding infrastructure.

## What Changes

- Chart annotation gains a **source choice** — *fixed text* (today's `config.annotation`, unchanged) or
  *bind to field* (a new `fieldMapping.annotation` slot referencing a bound DataType column), presented via
  the existing `BoundOrLiteralField` control that Metric label/unit and Text content already use.
- The chart renderer resolves the bound annotation from the current row snapshot (first row / single-row
  value), so it updates reactively when the data changes.
- Static annotations and captions keep working exactly as before (backward compatible — literal wins).
- **Image caption binding is explicitly deferred** (see Non-goals): image panels have no
  `dataTypeId`/`fieldMapping` infrastructure, and adding it is disproportionate to this low-priority
  follow-on — the same prerequisite already documented for Text/Markdown in
  `panel-config-field-or-literal-pattern`.

## Capabilities

### New Capabilities

_None._ This extends existing panel capabilities and reuses the established field-or-literal pattern.

### Modified Capabilities

- `echarts-chart-panel`: the annotation may be sourced from a bound DataType field, rendered from the row
  snapshot and updating on data change; static annotation unchanged.
- `panel-config-field-or-literal-pattern`: the chart Annotation control becomes a new consumer of the
  reusable `BoundOrLiteralField` pattern.
- `image-panel-type`: records that caption **binding** is intentionally out of scope, with the reason, while
  the static caption stays as-is.

## Impact

- Frontend: `ChartDisplayFields`, `useChartDisplayState`/`BindingEditor` (BoundOrLiteralField wiring),
  `PanelContent`/`ChartRenderer` (resolve bound annotation from row data), panel payload/thunk plumbing.
- Schema/docs: `schemas/panel.schema.json` (document the `fieldMapping.annotation` slot), MCP `write.ts`
  passthrough note. No new DB column, no chart domain/migration change — `fieldMapping` is a free-form
  object already stored, round-tripped, and included in the panel query via `selectedFieldsFromMapping`.

## Non-goals

- **Image-caption binding** — deferred; image panels lack binding infrastructure (documented reason).
- No new aggregation over annotation values; the bound annotation is a single-cell (first-row) lookup.
