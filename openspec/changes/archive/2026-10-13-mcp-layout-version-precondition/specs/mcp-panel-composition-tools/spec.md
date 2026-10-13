## ADDED Requirements

### Requirement: MCP dashboards expose the layout version
helio-mcp's dashboard type SHALL include the server's `layoutVersion`, and every MCP tool that returns a dashboard
record (including `list_dashboards`, `get_dashboard`, `update_dashboard_layout` and `auto_layout_dashboard`) SHALL pass
it through unchanged, so an agent can echo the version of the dashboard it last read.

#### Scenario: get_dashboard returns the layout version
- **WHEN** an agent calls `get_dashboard` on a dashboard whose stored `layoutVersion` is N
- **THEN** the result carries `layoutVersion` N

### Requirement: MCP layout tools surface a layout conflict without retrying
When `PATCH /api/dashboards/:id` or `POST /api/dashboards/:id/auto-layout` returns 409 with a `dashboard` in its body,
the calling MCP tool SHALL return an error result that names the conflict and carries that current dashboard, including
its `layoutVersion`, and SHALL tell the agent to recompute against it and call again with that version. The tool SHALL
NOT re-send the write, with or without a precondition. `place_outputs` SHALL surface a conflict from its internal pack
the same way and SHALL name the panels it created but did not position.

#### Scenario: Stale update_dashboard_layout
- **WHEN** an agent read layout version N, another writer then changes the layout, and the agent calls
  `update_dashboard_layout` with `expectedLayoutVersion` N
- **THEN** the tool returns an error result carrying the current dashboard with its newer `layoutVersion`, exactly one
  PATCH was sent, and the other writer's layout is what is stored

#### Scenario: place_outputs pack conflict
- **WHEN** `place_outputs` creates panels and its follow-up auto-layout returns 409
- **THEN** the error result names the created panel ids, says they were not positioned, and carries the current
  dashboard

## MODIFIED Requirements

### Requirement: auto_layout_dashboard packs panel sizes into a non-overlapping layout

The MCP `auto_layout_dashboard` tool SHALL accept a dashboard id, a list of `{panelId, w, h}` sizes, an optional `breakpoint` and an optional `expectedLayoutVersion`, call `POST /api/dashboards/:id/auto-layout`, and return the packed, persisted layout — replacing the need for an agent (e.g. `helio-news`'s `_pack`/`_fill_shelf`/`_clamp`) to compute panel positions itself. Without `breakpoint` every breakpoint is packed at its own column count; with it only that breakpoint changes. When `expectedLayoutVersion` is given it SHALL be sent in the request body; when omitted the request SHALL carry no precondition.

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

#### Scenario: Precondition forwarded
- **WHEN** an agent passes `expectedLayoutVersion` N
- **THEN** the auto-layout request body carries `expectedLayoutVersion` N

### Requirement: update_dashboard_layout sets one breakpoint without touching the others

The MCP `update_dashboard_layout` tool SHALL accept `items` with an optional `breakpoint` (`lg|md|sm|xs`, default `lg`) in that breakpoint's own column units, and alternatively a `layouts` object keyed by breakpoint. It SHALL PATCH only the breakpoints named, leaving every other breakpoint as stored, and SHALL NOT copy one placement to all four breakpoints. The listed items become that breakpoint's complete layout. Server `400` layout rejections (breakpoint and panel ids) SHALL be surfaced verbatim. The tool SHALL require a non-negative integer `expectedLayoutVersion`, the `layoutVersion` of the dashboard the agent last read, and SHALL send it in the same PATCH body as `layout`.

#### Scenario: Agent repairs xs without overwriting lg
- **WHEN** an agent calls `update_dashboard_layout` with `breakpoint: "xs"` and valid 2-column items
- **THEN** only `xs` is sent in the PATCH and `lg` is unchanged

#### Scenario: Overlapping xs is rejected verbatim
- **WHEN** an agent supplies overlapping `xs` items
- **THEN** the tool returns the backend's 400 message naming `xs` and the panel ids

#### Scenario: Precondition sent with the layout
- **WHEN** an agent calls `update_dashboard_layout` with `expectedLayoutVersion` N
- **THEN** the PATCH body carries `layout` and `expectedLayoutVersion` N

#### Scenario: Missing precondition is refused before any request
- **WHEN** an agent calls `update_dashboard_layout` without `expectedLayoutVersion`
- **THEN** the call is rejected by input validation and no request is sent
