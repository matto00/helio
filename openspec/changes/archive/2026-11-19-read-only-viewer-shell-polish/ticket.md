# HEL-1782: Read-only shell polish for dashboard viewers

## Description

Child 4 of HEL-1773. HEL-1773 opens shared dashboards read-only for viewers. This ticket finishes the experience.

## Acceptance Criteria

- A visible "View only" indicator in the dashboard meta row and on the phone meta line.
- Empty states and calls to action on a viewer's dashboard never invite editing.
- Command palette and quick launcher entries that edit are absent for viewers.
- Editing keyboard shortcuts (undo/redo, layout) do nothing for viewers.
- The phone dashboard sheet, chips and pull-to-refresh behave correctly for viewers and editors.
- A user whose only dashboards are shared with them gets a defined first-run experience, not the generic "No dashboard open" state.
- The phone chip's "Shared" marker matches the sidebar and Home badges.
- Checked against the running app in both themes.

## Origin

origin_kind: followup, origin_ticket: HEL-1773. Draft: `.concertino/runs/HEL-1773/evidence/.concertino/scratch/HEL-1773/children.md` (Child 4).

## Owner rulings (Planning escalation, 2026-11-19)

1. A user who owns no dashboards but has some shared with them gets the most recently updated shared dashboard opened automatically on /dashboards, as owned ones are.
2. The existing first-run "build your own" drop zone is offered to a shared-only user on both Home and /dashboards.
