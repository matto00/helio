## ADDED Requirements

### Requirement: auto_layout_dashboard packs panel sizes into a non-overlapping layout

The MCP `auto_layout_dashboard` tool SHALL accept a dashboard id and a list of `{panelId, w, h}` sizes,
call `POST /api/dashboards/:id/auto-layout`, and return the packed, persisted layout — replacing the
need for an agent (e.g. `helio-news`'s `_pack`/`_fill_shelf`/`_clamp`) to compute panel positions itself.

#### Scenario: Agent packs a set of newly created panels
- **WHEN** an agent calls `auto_layout_dashboard` with a dashboard id and an ordered list of panel sizes
- **THEN** the tool posts to the auto-layout endpoint and returns the dashboard's updated, non-overlapping
  layout in the same order the sizes were supplied

#### Scenario: Backend validation errors surface verbatim
- **WHEN** the request includes a `panelId` that does not belong to the target dashboard
- **THEN** the tool surfaces the backend's 400 message unchanged, not a generic failure
