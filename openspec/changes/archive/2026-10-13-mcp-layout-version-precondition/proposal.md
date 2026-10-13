## Why

HEL-1457 made dashboard layout writes compare-and-set on a server-maintained `layoutVersion`, with an optional
`expectedLayoutVersion` precondition that returns 409 `{message, dashboard}` on a mismatch. The web client sends it;
helio-mcp does not. A stale agent calling `update_dashboard_layout` therefore still replaces whole breakpoints computed
from a layout it read earlier, dropping placements a browser tab or another agent made in between.

## What Changes

- helio-mcp's `DashboardResponse` type carries `layoutVersion`, so every dashboard an agent reads or writes exposes it.
- **BREAKING (MCP tool contract):** `update_dashboard_layout` requires `expectedLayoutVersion` (the `layoutVersion` of
  the dashboard the agent last read) and sends it with the PATCH.
- `auto_layout_dashboard` accepts an optional `expectedLayoutVersion` and sends it when given.
- On a 409 layout conflict, both tools return an error result carrying the server's current dashboard (with its
  `layoutVersion`) and never retry. `place_outputs`' internal pack surfaces a conflict the same way, naming the panels
  it created but could not position.
- helio-mcp README documents the precondition and the conflict result.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-panel-composition-tools`: `update_dashboard_layout` and `auto_layout_dashboard` send the layout-version
  precondition and surface a 409 conflict with the current dashboard; dashboards expose `layoutVersion`.

## Non-goals

- Making the server require the precondition (an owner call the ticket defers until after this ships).
- Auto-rebasing an agent's layout on a 409 (the agent re-reads and recomputes; see design.md D4).
- Schema changes for `apply_patch_set`: its dashboard `patch` already forwards `expectedLayoutVersion`; this change
  only documents it (design.md D5). `replace_dashboard_contents`, `apply_proposal`: no caller precondition exists.
- Backend, frontend, schema or migration changes. No migration is needed.

## Impact

`helio-mcp/src/types.ts`, `helioApi.ts`, `httpClient.ts` (error body retained), `tools/write.ts`,
`tools/layoutHandlers.ts`, `tools/placementsHandlers.ts`, their tests, and `helio-mcp/README.md`. External agents that
call `update_dashboard_layout` must now pass `expectedLayoutVersion`. helio-mcp's `dist` is gitignored and is not
rebuilt by a merge; sessions pick this up only after a local `npm run build` and MCP reconnect.
