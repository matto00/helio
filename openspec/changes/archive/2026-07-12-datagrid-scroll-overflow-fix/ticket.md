# HEL-254: Remove overflow:hidden — proper scroll for all data grids

**Epic:** HEL-240 (Data Grid Standardization), Phase 2 grid chain — this is the
FIRST ticket of the chain (HEL-254 scroll -> HEL-252 density -> HEL-253
draggable widths, delivered serially one at a time).

**URL:** https://linear.app/helioapp/issue/HEL-254/remove-overflowhidden-proper-scroll-for-all-data-grids

## Description

Today every table wrapper sets `overflow: hidden`, which clips data instead of
letting users scroll. Replace with proper scroll behavior.

### Behavior

- DataGrid wrapper uses `overflow: auto` (both axes) on the *scrolling*
  container.
- Sticky table header so vertical scroll keeps the header visible.
- Grid resizes to fit the parent container; if content overflows, scroll is
  offered.
- Panel cards stop clipping their table content.

### Audit surfaces

- `panel-grid-card` table wrappers
- `pipeline-detail-page__step-preview-table-wrapper`
- `preview-table__wrapper`
- `panel-detail-modal__data-section` tables
- Any other rule containing `overflow: hidden` adjacent to a `<table>`

### Definition of done

- No `overflow: hidden` on any DataGrid wrapper
- Table content scrolls correctly in panels with wide schemas or many rows
- Headers stay visible during vertical scroll
- Manual verification: a Table panel with 30 columns + 200 rows scrolls
  cleanly in both directions

Depends on unified DataGrid primitive (sibling — HEL-251, already merged).

## Orchestrator context (not part of the ticket itself)

- Builds on HEL-251 (merged): the canonical DataGrid primitive lives at
  `frontend/src/shared/ui/DataGrid.tsx` (+ `.css`), and the 5 table surfaces
  (TypeDetailPanel, SourceDetailPanel, PipelinePreviewModal, StepCard preview,
  SqlTab, TableRenderer's table-panel body) were migrated onto it. This
  ticket's scroll fix should be applied at/through that shared DataGrid
  primitive where possible, so all consumers benefit — call out the seam in
  the design.
- HEL-252 (density) and HEL-253 (drag widths) will build on this same
  primitive next — keep the change clean and minimal so it doesn't complicate
  those follow-on tickets.
- PanelGrid uses React Grid Layout with `noCompactor` set — be careful that
  grid-cell scroll changes don't fight the panel layout system (e.g. a grid
  cell growing to fit content rather than respecting its allotted height).
- Bind to `DESIGN.md` for all frontend work.
