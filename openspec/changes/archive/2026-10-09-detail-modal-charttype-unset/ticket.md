# HEL-1378: PanelDetailModal.buildInitialChart still defaults chartType to "line" (re-introduces HEL-1304's bug if the chart section is enabled)

## Description

origin_kind: followup
origin_ticket: HEL-1304

`frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:58` `buildInitialChart` defaults `chartType` to "line".
The chart section of that sheet is currently hidden, so it is harmless today, but if the section is enabled, saving the
sheet would store an implicit "line" that overrides the Output's `config.chartType` — exactly the bug HEL-1304 fixed on
the backend merge path.

## Acceptance criteria

* `buildInitialChart` leaves `chartType` unset when the panel has none stored (panel → Output config → line precedence
  stays intact).
* Unit test: a panel with no stored chartType bound to a bar Output → initial chart has no chartType, and a save does not
  send one.

## Driver / owner context

* HEL-1379 owner ruling: do nothing about implicit "line" values already stored in the DB — no migration, no row edits.
* HEL-1398 (in flight) touches ChartRenderer/PanelContent; HEL-1399 (queued) splits PanelContent.tsx/PanelDetailModal.tsx.
  Keep this change minimal so it collides with neither.
