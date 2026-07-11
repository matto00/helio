## Why

Pipelines are contracts: their source and output type are commitments, not casually swappable. The
pipeline detail page's bound-source bar already dropped the old toggle/"+ Connect source" affordance
(HEL-241 cycle), but it still gives no way to reach the source or output type at all, and nothing
stops a shared editor (who has pipeline-level access, not source/type ownership) from being offered
edit actions they can't actually use.

## What Changes

- Add an **"Edit Source"** button to the bound-source bar that navigates to `/sources` with that
  source selected.
- Add an **"Edit Type"** button (new bar, same visual pattern) that navigates to `/registry` with
  the pipeline's output DataType selected.
- Both buttons are **navigation-only** — no inline edit affordance on the pipeline detail page itself.
- Gate both buttons on the current user actually owning the underlying DataSource/DataType (checked
  against the user's own already-fetched, owner-scoped `sources.items` / `dataTypes.items`) — not on
  pipeline ownership or the pipeline-sharing `editor` role, which grants pipeline mutation rights but
  not source/type editing rights.
- Copy stays singular ("Source", not "Sources") — already true on `main`; no regression introduced.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-editor-page`: bound-source bar gains an ownership-gated "Edit Source" button; a new
  output-type bar with an ownership-gated "Edit Type" button is added to the page.

## Impact

- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` — add Edit Source button + props.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — new type-bar render, ownership checks,
  `fetchDataTypes` on mount, navigation wiring.
- New `frontend/src/features/pipelines/ui/BoundTypeBar.tsx`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — new bar/button styles.
- `openspec/specs/pipeline-editor-page/spec.md` — delta.

## Non-goals

- Building inline source/config or type-field editing UI on the pipeline detail page itself.
- Multi-source pipelines (explicit v1.4 stretch, per ticket).
- Changing `SourcesPage` / `TypeRegistryPage` capabilities beyond being a navigation target.
