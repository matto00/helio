## ADDED Requirements

### Requirement: create_panels collapses a panel fan-out into one call

The MCP server SHALL expose a `create_panels` tool wrapping `POST /api/panels/batch`, accepting
`{ dashboardId, panels: [...] }` where each entry has the same shape `create_panel` accepts (minus
`dashboardId`, supplied once). The tool description SHALL document that all panels are created
atomically (one bad item creates nothing) and returned in input order, and that this is the
preferred path for laying down several panels on one dashboard in a single call (e.g. a story's
image + markdown pair, or a batch of pre-created data panels later bound with `bind_panel`) — the
existing `create_panel` tool remains available and unchanged for a single panel.

#### Scenario: Agent creates several panels in one call
- **WHEN** an agent calls `create_panels` with a `dashboardId` and three panel specs (image,
  markdown, metric)
- **THEN** the tool makes exactly one HTTP request to `POST /api/panels/batch` and returns all three
  created panels with ids, in the order supplied

#### Scenario: A bad item's error is surfaced verbatim
- **WHEN** the backend rejects the batch because one item has an invalid `type` or chart type
- **THEN** the tool surfaces the backend's 400 message unchanged, naming the offending item, and no
  panels are created
