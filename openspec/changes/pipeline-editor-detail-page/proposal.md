## Why

The pipeline list page (HEL-140) lets users see their pipelines but provides no way to view or author the transformation steps. Without a detail page, pipelines are inert — users cannot configure sources, build transformation chains, or inspect output schemas. This delivers the first version of the editor so the product has an end-to-end authoring surface.

## What Changes

- Add route `/pipelines/:id` registered in `App.tsx` inside the protected AppShell routes.
- New `PipelineDetailPage` component with three sections: source selector bar, river view (ribbon + step cards), and footer bar.
- `PipelinesPage` list items become clickable links navigating to `/pipelines/:id`.
- Source chips load from `GET /api/data-sources`; each chip has toggle + inline preview affordance.
- Transformation steps are local React state (no persistence — that is HEL-228).
- Static decorative SVG ribbon segments render between step cards to convey data flow.
- Footer bar shows editable output name, inferred schema chips, row/step stats, and an orange "Run pipeline ▶" button that shows a placeholder toast.

## Capabilities

### New Capabilities
- `pipeline-editor-page`: Full detail/editor page for a single pipeline — source selector, river view with ribbon + step accordion cards, footer bar with output name and run CTA.

### Modified Capabilities
- `frontend-protected-routes`: Register `/pipelines/:id` route inside the authenticated shell.

## Impact

- `frontend/src/App.tsx` — new route entry.
- `frontend/src/pages/PipelinesPage.tsx` — add link to detail page per row.
- New files: `PipelineDetailPage.tsx`, `PipelineDetailPage.css`, `PipelineDetailPage.test.tsx`.
- No backend changes. No new API endpoints. No schema changes.
- Reads existing `GET /api/data-sources` and `GET /api/pipelines`.

## Non-goals

- Persisting steps to the backend (HEL-228).
- Real pipeline execution (HEL-229).
- Dynamic ribbon recalculation based on actual column schema.
- Drag-and-drop step reordering.
