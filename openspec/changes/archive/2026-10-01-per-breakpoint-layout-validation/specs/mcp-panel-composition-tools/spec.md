## ADDED Requirements

### Requirement: update_dashboard_layout sets one breakpoint without touching the others

The MCP `update_dashboard_layout` tool SHALL accept `items` with an optional `breakpoint` (`lg|md|sm|xs`, default `lg`) in that breakpoint's own column units, and alternatively a `layouts` object keyed by breakpoint. It SHALL PATCH only the breakpoints named, leaving every other breakpoint as stored, and SHALL NOT copy one placement to all four breakpoints. The listed items become that breakpoint's complete layout. Server `400` layout rejections (breakpoint and panel ids) SHALL be surfaced verbatim.

#### Scenario: Agent repairs xs without overwriting lg
- **WHEN** an agent calls `update_dashboard_layout` with `breakpoint: "xs"` and valid 2-column items
- **THEN** only `xs` is sent in the PATCH and `lg` is unchanged

#### Scenario: Overlapping xs is rejected verbatim
- **WHEN** an agent supplies overlapping `xs` items
- **THEN** the tool returns the backend's 400 message naming `xs` and the panel ids

## MODIFIED Requirements

### Requirement: auto_layout_dashboard packs panel sizes into a non-overlapping layout

The MCP `auto_layout_dashboard` tool SHALL accept a dashboard id, a list of `{panelId, w, h}` sizes and an optional `breakpoint`, call `POST /api/dashboards/:id/auto-layout`, and return the packed, persisted layout — replacing the need for an agent (e.g. `helio-news`'s `_pack`/`_fill_shelf`/`_clamp`) to compute panel positions itself. Without `breakpoint` every breakpoint is packed at its own column count; with it only that breakpoint changes.

#### Scenario: Agent packs a set of newly created panels
- **WHEN** an agent calls `auto_layout_dashboard` with a dashboard id and an ordered list of panel sizes
- **THEN** the tool posts to the auto-layout endpoint and returns the dashboard's updated, non-overlapping
  layout in the same order the sizes were supplied

#### Scenario: Backend validation errors surface verbatim
- **WHEN** the request includes a `panelId` that does not belong to the target dashboard
- **THEN** the tool surfaces the backend's 400 message unchanged, not a generic failure

#### Scenario: Single-breakpoint pack
- **WHEN** an agent passes `breakpoint: "xs"`
- **THEN** the request carries `breakpoint` and the other breakpoints are unchanged
