## 1. Frontend

- [x] 1.1 Remove `overflow: hidden` from `.panel-grid-card` in
      `frontend/src/features/panels/ui/PanelGrid.css`; confirm no other declaration on the same
      selector re-adds clipping.
- [x] 1.2 Remove `overflow: hidden` from `.panel-detail-modal__view-body` in
      `frontend/src/features/panels/ui/PanelDetailModal.css`.
- [x] 1.3 In `frontend/src/features/sources/ui/SourceDetailPanel.tsx`, wrap
      `.source-detail-panel__schema-table` in a new `.source-detail-panel__schema-table-wrapper`
      `<div>`; in `SourceDetailPanel.css` move the `border-radius` (and any border needed for the
      rounded-corner visual) onto the wrapper with `overflow: auto`, and remove `overflow: hidden`
      from the `<table>` rule.
- [x] 1.4 Re-check every other panel-type CSS that shares `.panel-grid-card` (metric, text, chart,
      image, markdown, divider) to confirm none relied on the card-level clip (per design.md's audit)
      — no code change expected, just a targeted re-read to catch anything missed.

## 2. Verification

- [x] 2.1 Run `npm run lint` and `npm run format:check` in `frontend/`.
- [x] 2.2 Run `npm test` in `frontend/` (existing suite; no new unit tests expected for pure CSS
      changes, but confirm `DataGrid.test.tsx` and `PanelContent.test.tsx` still pass).
- [x] 2.3 Manual/dev-server verification of the ticket's DoD scenario: create or use a table panel
      bound to data with 30 columns and 200 rows; confirm it scrolls cleanly both vertically (header
      stays pinned) and horizontally, with no clipped/cut-off content, in both the dashboard grid
      card and the panel detail modal's view mode.
- [x] 2.4 Manual spot-check: `SourceDetailPanel`'s inferred-schema table (rounded corners preserved,
      no clipping if the field list is long).
