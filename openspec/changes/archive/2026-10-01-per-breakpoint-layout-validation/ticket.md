# HEL-1071: MCP layout tools cannot express a per-breakpoint layout, so agent-built dashboards ship overlapping panels on mobile

## Description

Found while building the "Roadmap — v0.7 & v0.8" dashboard (7ad267a8-0452-4557-be67-59290985efbc) via the MCP agent path. That dashboard has colliding panels at the `xs` breakpoint (two pairs of metric tiles at the same cell; three tiles laid out across a 2-column grid). `PanelGrid` sets `noCompactor`, so nothing untangles this at runtime.

Both MCP layout tools flatten breakpoints: `update_dashboard_layout` ("The same placement is applied to all breakpoints.") and `auto_layout_dashboard` ("Same placement is applied to all four responsive breakpoints."). An agent can only repair `xs` by overwriting lg/md/sm. `auto_layout_dashboard` also reported success while producing an overlap.

## Acceptance criteria

1. `update_dashboard_layout` accepts per-breakpoint items or a `breakpoint` parameter, so an agent can set `xs` without destroying `lg`.
2. `auto_layout_dashboard` is breakpoint-aware: it reflows per breakpoint's column count and can never emit an overlap or overflow.
3. OWNER RULING (2026-10-01): REJECT, never clamp. An overlapping layout is never a valid saved state while `noCompactor` is set. The server returns 400 naming the colliding panel ids AND the breakpoint, and saves nothing. No silent clamping/reflow on write. Applies to every write path that stores a layout (REST PATCH, MCP tools, proposal/apply, auto-layout, duplicate/import), enumerated from the code.
4. (OUT OF SCOPE, owner ruling) Fixing the xs layout on dashboard 7ad267a8 — production data, goes through the driver. Report what fixing it would take.
5. Client/server parity: backend validation mirrors frontend `breakpointLayout.ts` (`rectsOverlap`, `findOverlaps`, `isItemInBounds`, `isLayoutValid`) semantics and column counts (lg 12, md 10, sm 6, xs 2), proven by a shared fixture both sides test against.
6. Existing saved dashboards that already hold overlapping/out-of-bounds breakpoints (the data HEL-1023 repairs at render) must stay editable: a user edit must not 400 because of an untouched stored-bad breakpoint.
7. Update schemas/openspec in the same change; check how helio-mcp is tested (root jest) and its dist (gitignored, not tracked).

## Notes
- Related: HEL-1023 (merged 8022ff73), HEL-148, HEL-1069, HEL-1070, HEL-1148.
- No migration expected (V114 is next if needed).
