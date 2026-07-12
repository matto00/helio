# HEL-253: Draggable column widths (with persistence on Table panels)

**Epic:** HEL-240 (Data Grid Standardization), Phase 2 grid chain (3rd/final ticket)
**Project:** Helio v1.5 — Panel System v2
**Priority:** Medium
**Linear URL:** https://linear.app/helioapp/issue/HEL-253/draggable-column-widths-with-persistence-on-table-panels

## Description

Make column widths user-resizable on Table panels. Persisted to panel config so the layout sticks across reloads.

## Behavior

- Drag handle on the right edge of each column header
- Minimum width (e.g. 60px) enforced
- Width changes debounced and persisted via existing panel-config update path
- Resizing one column does not affect others (no automatic redistribution)

## Definition of done

- Drag-to-resize works on Table panels
- Widths persist across reload
- Preview variants of DataGrid do NOT expose resizing (read-only context)

## Notes

Depends on unified DataGrid primitive (sibling: HEL-251, merged). Coordinates with table panel config rework (sibling: HEL-255 "Table config rework") on where widths are stored on the panel model.

## Orchestrator context (from human operator, not in original ticket)

This is the THIRD and final ticket of the Phase 2 grid chain:
HEL-254 (scroll) [merged] -> HEL-252 (density) [merged] -> HEL-253 (draggable column widths) [this ticket].

Build on the canonical DataGrid primitive at `frontend/src/shared/ui/DataGrid.tsx` (+ `.css`),
established by HEL-251 and hardened by HEL-254 (scroll) + HEL-252 (density).

Add column-resize as a first-class capability on the shared DataGrid where it makes sense, but
the persistence dimension is scoped to Table PANELS specifically (persisted to the panel/dashboard
backend). Ephemeral preview grids (StepCard/SqlTab/PreviewModal) must NOT expose resizing per the
ticket's DoD ("Preview variants of DataGrid do NOT expose resizing (read-only context)").

**IMPORTANT scope-boundary flag (pattern learned from HEL-252):** HEL-252 (density) ended up
primitive-only, deferring its Table-config surfacing to HEL-255. For HEL-253, the drag interaction
itself is believed to be net-new (not already built), making this a fuller ticket than 252 — but:

- If part of this is found to already be implemented, STOP and escalate before building further.
- If "persistence on Table panels" overlaps HEL-255's "Table config rework" scope such that it's
  ambiguous whether width-persistence (data model / storage location) belongs in HEL-253 or
  HEL-255, STOP and escalate this boundary to the human before implementing the persistence piece.
  HEL-255 is planned to surface both HEL-252 and HEL-253 in the Table config UI; clarify division
  of responsibility (this ticket may own the underlying persisted field + wiring, HEL-255 may own
  exposing it in a config UI) rather than assuming.

Bind to DESIGN.md for all frontend work. PanelGrid uses React Grid Layout with `noCompactor` —
ensure column-drag interactions inside a panel do not conflict with panel-level drag/resize
handles (event propagation boundaries matter).

Local main was up to date at 00e8284 (includes HEL-254 + HEL-252) at branch-cut time.
