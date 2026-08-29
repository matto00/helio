## ADDED Requirements

### Requirement: update_dashboard MCP tool
The MCP server SHALL expose an `update_dashboard` tool that accepts a `dashboardId` and a required non-empty `name`,
PATCHes `PATCH /api/dashboards/:id` with only that `name`, and returns the updated dashboard. Renaming SHALL preserve
the dashboard's id, so existing links to it keep resolving; the tool exists specifically to replace the lossy
delete-and-recreate that a name correction otherwise requires. The tool SHALL NOT accept `layout`, which already has its own
dedicated tool, nor `appearance`, which is out of scope for this capability. The tool's description SHALL NOT claim
that either field is covered elsewhere on the MCP surface unless it actually is.

#### Scenario: Agent corrects a dashboard name
- **WHEN** an agent calls `update_dashboard` with a `dashboardId` and a new `name`
- **THEN** the tool PATCHes the backend and returns the dashboard with the new name

#### Scenario: Rename preserves the dashboard id
- **WHEN** an agent renames a dashboard via `update_dashboard`
- **THEN** the returned dashboard's id is the same id it had before the rename, and any link built from that id
  still resolves

#### Scenario: A name containing an ampersand is not entity-encoded
- **WHEN** an agent calls `update_dashboard` with a name containing `&`
- **THEN** the stored name contains a literal `&` and never acquires an HTML entity such as `&amp;` anywhere on the
  MCP request or response path
