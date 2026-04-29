## Context

The frontend currently issues a separate HTTP call for every discrete user action that mutates server state. This has been observable in the network tab but has never been formally catalogued. The audit investigates the existing service layer (`dashboardService.ts`, `panelService.ts`), the Redux thunks in `dashboardsSlice.ts` and `panelsSlice.ts`, and the triggering UI components (`PanelGrid.tsx`, `PanelDetailModal.tsx`, `DashboardAppearanceEditor.tsx`, `DashboardList.tsx`).

## Goals / Non-Goals

**Goals:**
- Enumerate every PATCH/POST call that can be issued in a normal dashboard editing session
- Document triggering interaction, endpoint, and payload shape for each
- Produce a quantitative call-volume estimate to baseline the batch API design

**Non-Goals:**
- Modifying any write paths
- Designing the batch API

## Decisions

**Audit-as-spec**: The findings are captured in a `write-path-audit` spec rather than a standalone markdown report so they are versioned alongside the codebase and can be referenced by future OpenSpec changes.

**Scope limited to dashboard session writes**: Data source / data type CRUD (add source, create type, etc.) is out of scope because those are setup operations, not per-session user actions on the dashboard canvas.

**Layout debounce counted as a single call per drag/resize stop**: The 250 ms debounce in `PanelGrid.tsx` coalesces rapid `onLayoutChange` events into one `PATCH /api/dashboards/:id` call per drag or resize interaction.

## Risks / Trade-offs

- [Audit completeness] Future UI additions could silently add new write paths — Mitigation: tasks.md will include a note to re-run the audit before finalising the batch API design.

## Planner Notes

Self-approved. This is a documentation-only task with no production code changes. No escalation criteria are met.
