## Context

Helio currently has five panel types: metric, chart, text, table, markdown. Panel types are represented
as a `sealed trait PanelType` in `model.scala`, a DB enum in migrations, and a string enum validated
in `RequestValidation`. The `Panel` case class already holds optional per-type fields (`content`,
`typeId`, `fieldMapping`). The `PanelRepository` stores them in corresponding nullable columns.
The frontend renders panel bodies in `PanelBody` (or equivalent) by switching on `panel.type`.

## Goals / Non-Goals

**Goals:**
- Add `image` as a valid panel type end-to-end (DB → API → frontend)
- Persist `imageUrl` (nullable text) and `imageFit` (nullable text: `contain|cover|fill`) on the panel row
- Render a `<img>` element with `object-fit` set to the stored fit value; placeholder when no URL
- Accept `imageUrl` and `imageFit` in `PATCH /api/panels/:id`
- Show `image` in the panel type selector

**Non-Goals:**
- File/binary upload storage
- DataType binding for image panels
- Image URL validation (accept any string)
- Animated GIF controls or image editing

## Decisions

### 1. New nullable columns vs. JSON blob
Store `image_url` and `image_fit` as separate nullable columns (consistent with how `content` is
stored for markdown panels). Avoids schemaless JSON parsing and keeps queries simple.

### 2. `imageFit` constraint
Store as a plain text column with application-level validation (`contain | cover | fill`).
Consistent with how `panel_type` is stored (text with application-level enum check).

### 3. Frontend `object-fit` mapping
Map `imageFit` values directly to CSS `object-fit` values — they are identical. This keeps the
component trivial: `<img style={{ objectFit: imageFit ?? 'contain' }} />`.

### 4. Placeholder when `imageUrl` is null
Show a grey placeholder with an image icon (consistent with other unbound panel placeholders).
No URL input in-grid — URL is set via the panel detail modal / PATCH flow.

### 5. No `refreshInterval` for image panels
`refreshInterval` is for data-bound panels. Image panels have no polling need.

## Risks / Trade-offs

- [URL stored unvalidated] → Could store broken URLs. Mitigation: frontend shows broken-image
  fallback; no server-side impact.
- [Migration adds columns to panels table] → Flyway runs on startup; nullable columns with no
  default are backward-compatible with existing rows.

## Migration Plan

1. New Flyway migration `V10__image_panel_type.sql`: add `image_url TEXT`, `image_fit TEXT` columns
   to `panels`; no data migration needed (nulls are fine for existing rows).
2. Update `PanelType.fromString` / `asString` to include `image`.
3. Update `Panel` case class, `PanelRow`, Slick projection, JSON protocols.
4. Update `PATCH` handler to pass `imageUrl` / `imageFit` through to repository.
5. Frontend: add `ImagePanel` component, wire into `PanelBody`, add `image` to type selector.

## Open Questions

None — scope is well-defined by the ticket.

## Planner Notes

Self-approved: adds a new nullable column pattern already established by `content`. No breaking
API changes. No external dependencies. Consistent with existing markdown panel implementation.
