## Why

The palette can navigate, create, show shortcuts and offer recents, but it cannot find a resource by name.
Typing a dashboard's name finds nothing. Nothing in the tree does client-side resource search today.

## What Changes

- **Widen `ResourceRef` into a discriminated union** so an Output — which needs a pipeline id AND an output
  id — is a first-class kind. HEL-519 authored this interface predicting exactly this change.
- **Index explicitly** (owner ruling): ensure each searchable kind's collection is actually fetched, rather
  than searching whatever a previous route happened to load. Reuses the EXISTING paginating client
  `listAllOutputs()` (`outputService.ts:66`), which loops until `total` is exhausted — `GET /api/outputs` is
  paginated (`limit` 200, max 500), so a single-page read would silently truncate the index.
- Contribute ranked, grouped results to the palette under their own section, using the `matchesQuery` opt-out
  so the contributor's own scoring is preserved.
- **Report coverage from live state**: while a kind is not yet indexed, name which kinds are searched right
  now — derived from actual per-kind status, never a hardcoded list.

## Capabilities

### New Capabilities

- `palette-resource-search`: typing in the palette finds the user's dashboards, data sources, data pipelines
  and outputs by name, and selecting a result opens it.
- `resource-search-index`: the application makes each searchable collection available to search regardless of
  which route the user is on, and reports which collections are currently searchable.

### Modified Capabilities

- `resource-navigation`: the navigable-resource reference gains an Output form carrying its pipeline, and a
  resource whose location needs more than an id becomes expressible.

## Impact

- `frontend/src/shared/chrome/resourceNavigation.ts` — `ResourceRef` union, `hrefFor` for outputs, navigator.
- `frontend/src/features/pipelines/state/outputsSlice.ts` — a thunk for `GET /api/outputs` (list-all).
- New: the index provider, the search selector, and the palette search contributor.
- `frontend/src/features/commandPalette/model/builtInActions.ts` — a search section in `SECTION_DISPLAY_ORDER`.
- No backend change: `GET /api/outputs` already exists (`OutputRoutes.scala:105`, HEL-906), and the Output
  deep-link `/pipelines/:id?outputId=<id>` already exists (HEL-909).

## Non-goals

- A backend **search** endpoint. `GET /api/outputs` is a list endpoint being reused, not a search API.
- **Panels — HEL-1038.** No `selectedPanelId`, no global registry, and `PanelDetailModal` is driven by local
  `useState` inside `DesktopPanelGrid`. Findable in principle, unnavigable in fact.
- **Connectors — HEL-1041.** No `/connectors/:id` route exists, so a result could only land on the list.
- `type` / `metrics` / `/registry` — retired by HEL-903/904.
