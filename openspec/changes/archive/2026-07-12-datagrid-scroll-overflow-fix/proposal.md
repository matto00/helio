## Why

Table wrappers across the app still rely on `overflow: hidden` on ancestor shells (panel cards, the
panel detail modal's view body, and a bespoke schema-listing table) to keep rounded corners tidy.
HEL-251 already gave the shared `DataGrid` primitive its own `overflow: auto` scroll box and sticky
header, but that contract was never formalized in the `data-grid` spec, and the surrounding ancestor
shells still hard-clip instead of guaranteeing a scrollbar. HEL-252 (density) and HEL-253 (drag
widths) build on this same primitive next, so the scroll contract needs to be explicit and correct
before they land.

## What Changes

- Formalize in the `data-grid` spec that `DataGrid` owns its own scroll container (both axes, sticky
  header) for both `full` and `preview` variants, and that consumers rendering it MUST NOT interpose
  an ancestor `overflow: hidden` between the grid and its sized container.
- Remove `overflow: hidden` from `.panel-grid-card` (`PanelGrid.css`) — the dashboard grid card shell
  wrapping `TableRenderer`'s `DataGrid`. Table content scroll is delegated to the grid's own scroll
  box; the card no longer hard-clips it.
- Remove `overflow: hidden` from `.panel-detail-modal__view-body` (`PanelDetailModal.css`) — the
  panel-detail "view" body wrapping `PanelContent`, same rationale.
- Fix `.source-detail-panel__schema-table` (`SourceDetailPanel.css`), the one remaining raw `<table>`
  with `overflow: hidden` directly on the element (not a `DataGrid` instance — a small inferred-schema
  field list). Move the rounded-corner clip to a wrapper `<div>` using `overflow: auto` instead of
  `hidden`, so a long field list scrolls instead of being cut off.
- Manual verification per ticket DoD: a Table panel with 30 columns + 200 rows scrolls cleanly in
  both directions, header stays pinned during vertical scroll.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-grid`: adds requirements that `DataGrid` provides its own bidirectional scroll container with
  a sticky header (both variants), and that no ancestor wrapper between `DataGrid` and its sized
  container may set `overflow: hidden`.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` / `.css` — no functional change; spec formalizes existing
  HEL-251 behavior.
- `frontend/src/features/panels/ui/PanelGrid.css` (`.panel-grid-card`)
- `frontend/src/features/panels/ui/PanelDetailModal.css` (`.panel-detail-modal__view-body`)
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` / `.css`
  (`.source-detail-panel__schema-table`)
- `openspec/specs/data-grid/spec.md` (delta)

## Non-goals

- Column density and drag-to-resize widths (HEL-252, HEL-253 — separate tickets in the same chain).
- Any change to `DataGrid.tsx`'s rendering/formatting logic.
- Re-clipping behavior for non-table panel types (image, chart, metric, text) — each already manages
  its own overflow locally and is unaffected by this change.
