## Context

The pipeline list page exists (as of HEL-140 parent ticket) but no detail/editor page exists. There are no pipeline-related frontend files in the codebase — `PipelinesPage`, `PipelineDetailPage`, pipelines slice, and pipelines service all need to be created from scratch. The app shell currently has routes for `/` (PanelList) and `/sources` (SourcesPage) — `/pipelines` and `/pipelines/:id` are not yet registered.

The sources Redux slice and `sourcesSlice.ts` / `dataSourceService.ts` already provide `fetchSources` / `GET /api/data-sources`. The new page reuses this slice directly rather than creating a parallel data path.

No `Pipeline` model exists in `types/models.ts`. Since HEL-228 adds the persistence API, this ticket uses a minimal local type: `{ id, name, outputDataTypeId? }`. Pipeline metadata is fetched from `GET /api/pipelines` and matched by id from the URL param. If that endpoint does not yet exist, the detail page degrades gracefully (shows the id as title).

## Goals / Non-Goals

**Goals:**
- Register `/pipelines` and `/pipelines/:id` routes inside the authenticated AppShell.
- Implement `PipelineDetailPage` with three sections: source selector bar, river view, and footer bar.
- Wire source selector to Redux `sources.items` via `fetchSources`.
- Steps are local `useState` — no Redux slice, no API calls.
- Decorative static SVG ribbon — not dynamically computed from columns.
- Footer "Run pipeline ▶" shows a placeholder message (alert or inline toast).
- Full Jest test suite covering route rendering, navigation, sources, empty state, add/remove steps, output name editing, and run button.

**Non-Goals:**
- Steps persistence (HEL-228).
- Real pipeline execution (HEL-229).
- Dynamic ribbon recomputation.
- Drag-and-drop step reordering.
- A `PipelinesPage` list view (that already exists or is a separate ticket in HEL-140 scope; the detail page will tolerate its absence by providing a back link to `/pipelines`).

## Decisions

**1. No new Redux slice for pipelines.**
Steps are session-local and don't need global sharing. A Redux slice would add boilerplate with no benefit for this ticket. Pipeline metadata fetch is minimal — use a local `useEffect` + `useState` inside the page component rather than a full slice. Revisit in HEL-228.

**2. Reuse `sourcesSlice` / `fetchSources` directly.**
The detail page dispatches `fetchSources()` if `sources.status === 'idle'` (same guard pattern used in `SourcesPage`). This avoids duplicate network calls when navigating between pages.

**3. Static SVG ribbon with 4 column bands.**
Computing a live ribbon from column schema requires HEL-228's step persistence and column tracking. A fixed decorative ribbon (hardcoded Bezier paths with design-token colors) delivers the design intent without blocking on future tickets.

**4. Op-type dropdown as a simple state toggle.**
The dropdown is implemented as a plain positioned `<ul>` controlled by `useState(null | insertIndex)`. No third-party dropdown library is introduced. Matches the pattern used for `ActionsMenu.tsx`.

**5. File co-location: components/PipelinesPage.tsx + PipelineDetailPage.tsx**
Other "page" components (`SourcesPage`) live in `frontend/src/components/`. Pipeline pages follow the same convention.

**6. CSS follows existing BEM-like class naming.**
`pipeline-detail-page`, `pipeline-detail-page__source-bar`, `pipeline-detail-page__river`, `pipeline-detail-page__footer` — mirrors `sources-page__*` patterns.

## Risks / Trade-offs

- `GET /api/pipelines` may not exist yet. Mitigation: fetch is wrapped in try/catch; on failure the page renders with the raw id as the pipeline name.
- Static ribbon may look odd at very narrow widths. Mitigation: `preserveAspectRatio="none"` on the SVG scales it proportionally; acceptable for this ticket.
- Adding `/pipelines` to the sidebar nav and breadcrumb requires touching `App.tsx`. Mitigation: minimal surgical edit — add a single `NavLink` to the sidebar and a breadcrumb branch for the pipelines path.

## Planner Notes

Self-approved. No new external dependencies, no breaking API changes. Pure frontend addition. Backend unchanged. This change fits within HEL-180's stated scope.
