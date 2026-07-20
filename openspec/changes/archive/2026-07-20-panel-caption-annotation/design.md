## Context

Image panels (`ImagePanelConfig(imageUrl, imageFit)`, `backend/.../domain/panels/ImagePanel.scala`) and
chart panels (`ChartPanelConfig(dataTypeId, fieldMapping, aggregation, chartOptions)`,
`ChartPanel.scala`) both persist their scalar config to dedicated columns via `PanelRowMapper`
(`i: ImagePanel => base.copy(imageUrl = ..., imageFit = ...)`). The wire shape is defined in
`schemas/panel.schema.json` (`ImageConfig`, `ChartConfig`), the TS mirror in
`frontend/src/features/panels/types/panel.ts`, and PATCH decode in each config's `Patch` object.
Rendering: `ImageRenderer → ImagePanel` renders an `<img>`; `ChartRenderer → ChartPanel` renders the
ECharts canvas. Config UI: `editors/ImageEditor.tsx` and `editors/ChartDisplayFields.tsx`.

## Goals / Non-Goals

**Goals:**
- Optional static `caption` (image) and `annotation` (chart) that round-trip create/PATCH/read and are
  editable in each panel's config editor.
- Render hidden-when-unset; scale with panel size; wrap/truncate rather than overflow.

**Non-Goals:**
- DataType-field-bound caption/annotation (see Decision 2). Static text only.
- Markdown/inline formatting of the text. Plain text only.
- New panel type, endpoint, or aggregation op.

## Decisions

**1. Dedicated nullable text columns, not JSONB.** Add `image_caption` and `chart_annotation` (both
`TEXT NULL`) in one Flyway migration (next is `V59`), mirroring the existing scalar-per-column idiom
(`image_url`, `image_fit`, `divider_color`, `divider_weight`). `PanelRowMapper.toRow` writes them from
the typed config; the per-subtype `imageConfig`/`chartConfig` builders read them back.
*Alternative:* fold `annotation` into the existing `chart_options` JSONB — rejected: image has no JSONB
column, so a column keeps image/chart symmetric and matches how every other scalar config field is
stored.

**2. Static literal text, not a bound field.** The ticket phrases DataType-field sourcing as a "may".
Image panels carry no `dataTypeId`/`fieldMapping` at all; the `BoundOrLiteralField` pattern
(`panel-config-field-or-literal-pattern`) requires binding infrastructure the image panel lacks. Adding
it is scope well beyond this ticket. Both fields are plain strings, edited with a simple text control.
Bound sourcing is a documented follow-up. *Alternative:* wire chart's annotation through
`BoundOrLiteralField` (chart already has `fieldMapping`) — rejected for this change to keep image and
chart symmetric and the surface focused; can be layered on later without a wire break (the field stays a
string; a future `fieldMapping.annotation` binding is additive).

**3. Wire field names `caption` (image) / `annotation` (chart), modeled as `Option[String]` with a
two-level Patch.** Matches the ticket vocabulary and the distinct rendering roles (caption strip vs.
chart subtitle). Each config field is `Option[String]` (unset ⇒ `None`), so — under
`DefaultJsonProtocol` — an unset field is **omitted** from the response `config`, never emitted as
`null`, consistent with the `collection-panel-type` / `ChartOptions` house convention. Because the
config field is itself `Option`, PATCH needs a **two-level** patch `Option[Option[String]]` (absent ⇒
`None` = leave unchanged; `Some(None)` = clear; `Some(Some(v))` = set), exactly like
`ChartPanelConfig.Patch.dataTypeId`/`aggregation` (`ChartPanel.scala`) — *not* the single-level
non-`Option` `imageUrl` Patch (`JsNull ⇒ Some("")`). At the decode boundary, `null`, empty, and
whitespace-only inputs all normalize to the cleared state (`Some(None)` on PATCH, `None` at rest) so a
cleared caption round-trips as an omitted field, never a stored `""`. Persisted column is SQL `NULL`
when `None`. Blank at render time ⇒ hidden (no empty strip).

**4. Rendering.** Image: a caption strip element beneath the `<img>` inside `ImagePanel`, styled via
`ImagePanel.css`, shown only when caption is non-blank; text clamps (CSS `line-clamp`/ellipsis) so it
scales with the panel and never pushes the image out. Chart: a subtitle/footnote element in
`ChartRenderer` (which owns the `panel-content--chart` wrapper) beneath the title area, shown only when
annotation is non-blank, with the same clamp treatment. Both threaded from `config` through the existing
renderer prop paths (`ImageRenderer` already receives `panel`; `ChartRenderer` gains an `annotation`
prop passed by `PanelContent`).

**5. MCP (stretch).** Extend the helio-mcp panel create/update tool schema
(`mcp-panel-composition-tools`) to accept `caption`/`annotation`, mapped straight onto the panel config
on apply. Gated last; drop if it destabilizes the core.

## Risks / Trade-offs

- [Config UI in two different editors diverges in look] → reuse the shared `TextField` control both
  editors already import; match label/spacing to `DESIGN.md` tokens.
- [Long caption overflows small panels] → CSS line-clamp + `min-width:0`; verify at mobile panel sizes.
- [PATCH clear-semantics mismatch] → use the two-level `Option[Option[String]]` Patch (Decision 3;
  `ChartPanelConfig.Patch.aggregation` precedent), normalize blank⇒cleared at decode, and cover
  absent/null/blank/value in ScalaTest.
- [Duplication/export parity] → both fields live on the typed config, so `duplicate`/export/import carry
  them automatically once `PanelRowMapper` round-trips them; add a regression assertion.

## Migration Plan

Forward-only Flyway migration adds two nullable columns; existing rows read `NULL ⇒ caption/annotation
absent` (today's behavior). No backfill, no rollback needed — dropping the feature leaves unused nullable
columns.

## Planner Notes

- Self-approved: static-text-only scope (Decision 2) and dedicated-column persistence (Decision 1). No
  external dependency, no breaking change, no new endpoint — within ticket scope, not escalated.
- Stretch (MCP, inline-Markdown) explicitly de-scoped from the required ACs; MCP may be attempted last.
