## Why

Agent-built dashboards ship overlapping/overflowing panels on mobile (HEL-1071): the MCP layout tools write one placement to all four breakpoints, the server accepts any geometry, and several server-side producers (proposal apply, contents replace, auto-layout, default placement) derive md/sm/xs by scaling a 12-column lg placement, which collapses items into the same cell at 2 columns. With `noCompactor`/`preventCollision` nothing untangles a saved overlap at runtime. Owner rulings (2026-10-01): reject, never clamp; reject out-of-bounds too; existing bad dashboards stay editable (a breakpoint identical to the stored one passes untouched).

## What Changes

- Server-side layout validation (mirrors frontend `breakpointLayout.ts` from HEL-1023): any caller-supplied breakpoint that differs from the stored one must be in bounds and non-overlapping, else the whole write is `400` naming the breakpoint and offending panel ids; nothing is saved. Breakpoints identical to stored pass through untouched; breakpoints absent from a PATCH are preserved.
- `PATCH /api/dashboards/:id` accepts a layout with any non-empty subset of `lg/md/sm/xs`.
- `auto_layout` is breakpoint-aware: optional `breakpoint`; omitted = every breakpoint packed independently at its own column count; the packer can no longer emit `w > cols`; kept panels are never overlapped by packed ones.
- A pure per-breakpoint reflow replaces proportional x/w scaling on system-generated paths (proposal apply, contents replace, default panel placement) so derived md/sm/xs are valid by construction; proposal layouts are validated before panels are created instead of failing silently.
- MCP: `update_dashboard_layout` gains `breakpoint` (default `lg`, no longer flattened to all four) and a per-breakpoint `layouts` form; `auto_layout_dashboard` gains `breakpoint`; descriptions corrected.
- A shared JSON parity fixture is asserted by both the frontend (jest) and backend (ScalaTest).
- **BREAKING (MCP)**: `update_dashboard_layout` without `breakpoint` now sets only `lg` (previously the same items to all four).

## Capabilities

### New Capabilities
- `dashboard-layout-validation`: server-side bounds/overlap validation of stored dashboard layouts, grandfathering rule, and client/server parity.

### Modified Capabilities
- `dashboard-auto-layout`: breakpoint-aware packing replaces "identical across all four breakpoints".
- `mcp-panel-composition-tools`: `auto_layout_dashboard` breakpoint parameter; per-breakpoint `update_dashboard_layout`.

## Impact

Backend: `DashboardServiceValidation`, `DashboardService`, `AutoLayoutService`, `PanelPacker`, `LayoutBreakpointScaling` (+ new `LayoutValidator`, `LayoutReflow`), `PanelService.placeDefaultLayout`, `DashboardProposalService`, `DashboardContentsService`, `DashboardSnapshotRepository` (import), protocols. Schemas: dashboard layout PATCH + auto-layout request. helio-mcp (tools, `helioApi`, tests via root jest; `dist/` is untracked, nothing to rebuild). Frontend: fixture parity test, panel-create adopts the server placement, `persistLayout` sends the displayed (resolved) breakpoint for any changed-invalid breakpoint, and a rejected save is surfaced and re-synced (design D11). No migration.
