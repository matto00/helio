# HEL-1657: "Last saved" label is missing or stale after a layout-only save (SaveStateIndicator reads panels.lastSavedAt only)

## Description

origin_kind: followup
origin_ticket: HEL-1584

Found by HEL-1584 (an existing bug). `SaveStateIndicator` derives its label from `panels.lastSavedAt`, which only
`updatePanelsBatch.fulfilled` sets. A **layout-only** save (`updateDashboardLayout.fulfilled`, from a drag, resize,
Tidy or Undo) leaves the label missing or stale ("Last saved 12m ago"), even though HEL-1584's new save check-mark
confirms the save happened.

**Fix:** record a shared last-saved timestamp on either save path (or show the later of the two), so the label
reflects the most recent save of any kind.

## Acceptance Criteria

- A red-first unit test: a layout-only save makes the label show "Last saved just now".
- An e2e on the dashboard meta row (HEL-1576) after a drag-only save shows "Last saved just now".

## Notes

Related: HEL-1584, HEL-1576. Priority Low. Labels: Follow-up, Bug. Frontend only; no migration.
