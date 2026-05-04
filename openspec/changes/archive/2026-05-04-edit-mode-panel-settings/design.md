## Context

The panel detail modal (`PanelDetailModal.tsx`) already implements view mode (default) and edit mode (tab-bar based).
Edit mode currently shows tabs: **Appearance**, **Data** (or Content / Image / Divider for those panel types). Each tab has its own form with its own Save button.

The ticket asks to consolidate these into a single scrollable form so all settings are visible at once in edit mode with a single unified Save.

## Goals / Non-Goals

**Goals:**
- Replace the tab bar in edit mode with a single scrollable form showing all sections
- All sections always visible: Appearance, Data / Field Mapping / Refresh, and type-specific (Content / Image / Divider) — appropriate sections shown for the panel's type
- Single Save / Cancel footer that submits all dirty sections in one pass
- Remove the tab-switching logic and per-tab save handlers; keep one combined submit
- The `ActionsMenu` "Customize" label already opens the modal — no entry-point changes needed
- No backend changes; all fields are already patched via existing thunks

**Non-Goals:**
- No backend schema or API changes
- No new Redux state beyond what already exists in `panelsSlice`
- No new routes, no external dependencies

## Decisions

**D1 — Single unified form with section headings instead of tabs.**
Rationale: tabs hide content and force mental context-switching. A scrollable form is simpler, matches the ticket's explicit ask, and requires less branching logic.

**D2 — Unified Save dispatches multiple thunks sequentially.**
Appearance uses `accumulatePanelUpdate` (sync dispatch). Data binding uses `updatePanelBinding` (async). Type-specific (content/image/divider) each have their own async thunk.
The unified save will run the relevant thunks for whichever sections are non-null for the panel type. On first failure, show inline error for that section and stop. Rationale: mirrors existing per-tab behavior but consolidated.

**D3 — Always show Appearance section; show Data section for data-capable types; show Content/Image/Divider section only for those panel types.**
Data binding is relevant to metric, chart, and any future data-bound types. Markdown / image / divider panels still show Appearance but replace the Data tab with their type-specific controls.
Concretely: `markdown` → Appearance + Content; `image` → Appearance + Image; `divider` → Appearance + Divider; all others → Appearance + Data.

**D4 — Remove the `Tab` type and `activeTab` state entirely.**
The `Tab` type, `activeTab` useState, and `handleTabChange` function are all deleted. Section visibility is driven by `panel.type`. This simplifies the component significantly.

**D5 — Title field added to Appearance section.**
The ticket lists "title" as an appearance setting. Currently title editing is done via inline rename on the grid. The unified form adds a title input in the Appearance section that also dispatches `accumulatePanelUpdate` with `{ title }`.

## Risks / Trade-offs

- [Risk] Long scrollable form may be unwieldy for chart panels which have many appearance controls → Mitigation: existing chart appearance controls are already verbose; a scroll is acceptable given the section headings act as visual separators.
- [Risk] Combined save complexity — multiple async calls in sequence → Mitigation: each section tracks its own saving/error state (same pattern as today); the save button is disabled while any section is saving.

## Planner Notes

- Self-approved: the change is contained to `PanelDetailModal.tsx` and its CSS. No architectural risk.
- The `AccumulatePanelUpdate` thunk is synchronous from the dispatch perspective (it writes to Redux and the write-accumulator handles the debounced PATCH), so appearance saves remain non-async.
- The "customization popover" referenced in the ticket description refers conceptually to the current per-tab editing surface; there is no separate panel customization popover component in the codebase — `DashboardAppearanceEditor` is a dashboard-level popover and is out of scope.
