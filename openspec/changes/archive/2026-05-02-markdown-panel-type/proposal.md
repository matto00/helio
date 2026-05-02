## Why

Helio panels currently support `metric`, `chart`, `text`, and `table` types but lack a way to display
rich formatted content. A Markdown panel type fills this gap by letting users embed CommonMark-rendered
notes, instructions, or documentation directly in a dashboard without requiring a DataType binding.

## What Changes

- Add `markdown` as a valid panel `type` value in the backend enum and Flyway migration
- Add a `content` field to the panels table for storing raw Markdown source
- Expose `content` in all panel API responses (null for non-markdown panels)
- Accept `content` on `POST /api/panels` and `PATCH /api/panels/:id`
- Render the markdown panel body as CommonMark HTML in the dashboard grid (read-only)
- Allow editing the Markdown source in the panel detail view edit mode
- Add `markdown` to the panel type selector UI

## Capabilities

### New Capabilities

- `markdown-panel`: CommonMark rendering and content editing for the markdown panel type

### Modified Capabilities

- `panel-type-field`: extend the valid type enum to include `markdown`; add `content` field to panel API
- `panel-type-rendering`: define read-only grid rendering and edit-mode behaviour for the markdown type

## Impact

- **Backend**: Flyway migration to add `content` column; `PanelRepository`, `ApiRoutes`, `JsonProtocols`,
  domain model updated to handle `content`; `RequestValidation` extended for `markdown` type
- **Frontend**: new `MarkdownPanel` component; CommonMark library dependency (`marked` or `react-markdown`);
  `panelsSlice` and panel service updated for `content` field; panel detail edit mode gains a textarea
- **Schemas**: `panel` JSON Schema extended with `type: markdown` and `content` field
- **No DataType binding** — markdown panels never have `typeId`; content is self-contained

## Non-goals

- Markdown editing toolbar / WYSIWYG editor (plain textarea only for now)
- Syntax highlighting for code fences beyond CommonMark rendering
- DataType binding for dynamic Markdown content
