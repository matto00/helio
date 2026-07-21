## Context

HEL-318 (PR #254) added static text: `ChartPanelConfig.annotation: Option[String]` (column
`chart_annotation`) rendered beneath the chart, and `ImagePanelConfig.caption`. Charts are already
bound (`dataTypeId` + free-form `fieldMapping: JsObject`); image panels are unbound
(`{ imageUrl, imageFit, caption }`).

The repo already has a reusable "bind to a DataType field, or use fixed text" pattern from HEL-243/293:
`BoundOrLiteralField.tsx` + `useBoundOrLiteralState.ts` + `defaultBoundOrLiteralMode`, consumed by
Metric label/unit, Text content, and Collections. Its contract: the literal lives in a dedicated config
field (e.g. `config.label`); the binding lives in `fieldMapping.<slot>`; literal wins when both are set;
the mode defaults to Fixed text when the literal is set, else Bind to field.

`usePanelData` already computes `data: MappedPanelData` for chart panels — every `fieldMapping` slot
resolved against the first row. `Panel.selectedFieldsFromMapping` collects **all** string values from
`fieldMapping`, so any bound column is automatically fetched by the panel query. There is no slot allowlist.

## Goals / Non-Goals

**Goals:**
- A chart annotation can be sourced from a bound DataType field, updating reactively when data changes (AC1).
- Static captions/annotations continue working unchanged (AC2).
- Image-caption binding is explicitly scoped out with a documented reason (AC3).
- Round-trips create/PATCH/read; gates green (AC4).

**Non-Goals:**
- Image-caption binding (deferred — see Decision 4).
- Aggregating annotation values or multi-row annotation lists — the bound annotation is a single-cell
  (first-row) lookup, consistent with Text/Markdown bound content.

## Decisions

### D1 — Bound annotation uses `fieldMapping.annotation`, not a new config field or column

The bound source is a new semantic slot in the existing free-form `fieldMapping` object:
`fieldMapping.annotation = "<columnKey>"`. Static text stays in the existing `config.annotation`.

Rationale: this is exactly the established field-or-literal contract (literal in `config.<x>`, binding in
`fieldMapping.<x>`). Because `fieldMapping` is already stored (`jsObjectColumn`), round-tripped, and
query-selected (`selectedFieldsFromMapping`), the backend needs **no domain change, no Flyway migration,
and no new column**. `schemas/panel.schema.json` already types `fieldMapping` as `type: object`, so the
wire shape is unchanged — we only add a documentation note for the reserved `annotation` slot.

Alternative considered: a sibling `annotationField: Option[String]` config column (my first instinct).
Rejected — it duplicates binding infrastructure `fieldMapping` already provides and diverges from the
metric/text precedent, adding a migration and domain plumbing for no benefit.

### D2 — Render resolution: literal-wins, from the row snapshot

`PanelContent` computes the effective chart annotation as `config.annotation ?? data?.annotation ?? null`
and passes it to `ChartRenderer`'s existing `annotation` prop (unchanged renderer). `data.annotation` comes
free from `usePanelData` (first-row value of the bound column). This gives AC1 reactivity with no new fetch
path, and literal-wins matches the Metric precedent (`usePanelData` HEL-293 Decision 4). By construction the
editor keeps them mutually exclusive (switching mode clears the other), so precedence is defensive only.

### D3 — Editor: reuse `BoundOrLiteralField` for the Annotation control

Replace the plain annotation `TextField` in `ChartDisplayFields` with `BoundOrLiteralField` (mode toggle:
Fixed text ↔ Bind to field), driven by a `useBoundOrLiteralState` instance added to the chart display state
(alongside the existing annotation string), wired through `BindingEditor`'s save path so Fixed-text writes
`config.annotation` (+ clears `fieldMapping.annotation`) and Bind-to-field writes `fieldMapping.annotation`
(+ clears `config.annotation` → `null`). Bind-to-field is only offered when a DataType is bound (`isBound`),
mirroring the scatter size/color field gating already in `ChartDisplayFields`. Mode default via
`defaultBoundOrLiteralMode(config.annotation !== undefined)`, mirroring Metric/Text.

### D4 — Image caption binding is deferred (documented)

Image panels have no `dataTypeId`/`fieldMapping` and no data-fetch path. Sourcing a caption from a field
would require adding the whole binding stack (config shape + fetch wiring + editor binding UI + query path)
to a panel type that has no other reason to be bound — disproportionate to a Low-priority follow-on. It is
the same class of binding-infrastructure prerequisite the field-or-literal pattern
(`panel-config-field-or-literal-pattern`) requires, which image panels — unlike Text/Markdown (bound since
HEL-244) — do not yet meet. The static image caption is unchanged. Revisit if/when image panels
gain binding for an independent reason. This satisfies AC3 (explicitly scoped out with a reason).

## Risks / Trade-offs

- [A stored `fieldMapping.annotation` inflates the chart's selected-field query] → the annotation column is
  already part of the DataType and the query fetches full rows anyway; one extra selected key is negligible.
- [Ambiguity if both `config.annotation` and `fieldMapping.annotation` are set] → literal-wins (D2), and the
  editor clears the inactive side on mode switch, so the ambiguity is not reachable through the UI.
- [MCP callers set `fieldMapping.annotation` directly] → already supported (fieldMapping passes through
  unchanged); only a `write.ts` doc note is needed, no new tool surface.

## Planner Notes (self-approved)

- No ESCALATION: additive, backward-compatible, within ticket scope; no new external dependency, no breaking
  API change, no major architectural change. Image defer is explicitly authorized by AC3.
- Scope locked to **chart annotation** bound sourcing + image-caption defer. No changes to other panel types.
