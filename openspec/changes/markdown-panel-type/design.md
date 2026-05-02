## Context

Helio panels have a `PanelType` sealed trait (`Metric`, `Chart`, `Text`, `Table`) in `domain/model.scala`.
The `Panel` case class holds `panelType`, `typeId`, `fieldMapping` — no free-text content field.
Flyway migrations are versioned (`V5__panel_type_binding.sql` is the current latest). The `PanelRepository`
reads/writes via Slick. `ApiRoutes` composes `PanelRoutes`. `JsonProtocols` provides Spray JSON formatters.

The frontend renders panel bodies in `PanelGrid` via a type-switch component. Panel detail edit mode
uses Redux state from `panelsSlice`.

## Goals / Non-Goals

**Goals:**
- Add `markdown` to the `PanelType` enum (backend + frontend)
- Add a `content: Option[String]` field to the `Panel` domain model
- Persist content in a new `content TEXT` column via Flyway `V10`
- Expose and accept `content` through the panels REST API
- Render markdown panels as CommonMark HTML in the grid
- Allow editing the Markdown source via a plain `<textarea>` in the panel detail edit mode

**Non-Goals:**
- WYSIWYG editor or Markdown toolbar
- Syntax highlighting within code fences
- DataType binding for dynamic Markdown content

## Decisions

### D1: `content` column is TEXT NULL on all panels, not just markdown

Keeping a single `content` column (rather than a separate `markdown_panels` table) follows the existing
flat panel schema pattern (same as `type_id`, `field_mapping`). NULL for non-markdown panels; non-null
for markdown panels. Simpler queries, no joins.

Alternatives considered: separate `markdown_panel_content` table (rejected — over-engineered for single field).

### D2: CommonMark library — `react-markdown`

`react-markdown` (with `remark-gfm` optional) is widely used, tree-shakeable, and renders directly
to React elements without `dangerouslySetInnerHTML`. This avoids XSS concerns inherent in HTML-string
injectors like `marked`.

Alternatives considered: `marked` + `dangerouslySetInnerHTML` (rejected — XSS surface); `@mdxjs/mdx`
(rejected — overkill).

### D3: Content sent in `PATCH /api/panels/:id` body

Markdown content is mutable, so it must be updatable. `PATCH` already handles appearance and type; adding
`content` to the patch request is consistent. No new endpoint needed.

### D4: No DataType binding validation for markdown panels

The backend will not enforce `typeId == null` for markdown panels; it simply stores whatever is sent.
The frontend will not show the DataType binding UI for markdown panels. Enforcement in the UI is sufficient
for v1.

## Risks / Trade-offs

- [Large markdown content] → No size limit on `TEXT` column. Mitigation: PostgreSQL TEXT is effectively
  unbounded; application-level limit can be added later if needed.
- [XSS via user markdown] → `react-markdown` renders to React elements, avoiding raw HTML injection.
  Mitigation: ensure no `rehype-raw` plugin is added.

## Migration Plan

1. Add Flyway `V10__panel_content.sql`: `ALTER TABLE panels ADD COLUMN content TEXT;`
2. No data backfill needed — existing panels default to NULL content.
3. Rollback: `ALTER TABLE panels DROP COLUMN content;` (no data loss since existing panels have NULL).

## Planner Notes

- Self-approved: `content` column on all panel rows (not markdown-specific) — follows existing pattern
- Self-approved: `react-markdown` dependency addition — standard, low-risk library
- Self-approved: no size limit for MVP
