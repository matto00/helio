## Why

Deleting a REST source created from a bare `url` leaves its auto-created `Auto: <name>` Connector behind. The Connector's
encrypted credential row can hold a real bearer token or API key, and both outlive the source with nothing referencing
them. The owner ruled (HEL-1497 escalation) that an unadopted Auto Connector must not outlive its last source.

## What Changes

- `DataSourceService.delete` removes the deleted `rest_api` source's Connector, together with its credential row, when
  all of these hold:
  - its server-owned `config.implicit` is `true`;
  - its name still starts with `Auto: `;
  - the real dependents count is zero.
- This applies to every path that deletes through `DataSourceService.delete`: the route, MCP, patch-set apply/undo,
  inline-root compensation and first-run rollback.
- The source delete is still the outcome. A cleanup failure is logged with ids only.
- Frontend: a successful source delete invalidates the cached Connectors list.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `connectors/connector-management`: new requirement covering source delete removing an unadopted auto-created
  Connector; the blocked-delete scenario is clarified.
- `inline-source-create-atomicity`: the explicitly-referenced-Connector scenario is narrowed to non-implicit or adopted
  Connectors.

## Impact

- Backend: `DataSourceService` gains an optional `ConnectorRepository`, wired in `ApiRoutes`. The rule helper lives
  beside `ImplicitConnectorCleanup` in `InlineSourceCleanup.scala`.
- Frontend: `connectorsSlice` resets on a fulfilled source delete.
- No API shape change. No migration.

## Non-goals

- Cleaning up existing leftover Auto Connectors in prod (HEL-1495).
- Any UI prompt or checkbox (the owner chose delete-silently).
- Refactoring `InlineSourceCleanup`'s own exact-name step. It becomes a harmless no-op, and its removal is a follow-up
  after HEL-1493.
- Auditing Connector deletes (no Connector delete is audited today).
