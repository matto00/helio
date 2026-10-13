## Why

HEL-1390 left five follow-ups (HEL-1440). Four are still live on main: four panel-level proposal fields that do
nothing are advertised to agents with no warning, three e2e specs ignore their cleanup-delete statuses, a rate-window
row blocks deleting its user, and chart test fixtures use slot names no chart has.

## What Changes

- Mark `ProposalPanel.fieldMapping`/`aggregation`/`label`/`unit` deprecated and ignored on the JSON schema, the
  assistant tool schema, the MCP zod schema and the frontend type. They stay accepted (no wire break).
- Migration V133: `pipeline_run_rate_window.user_id` becomes `ON DELETE CASCADE`; user-reference inventory updated.
- e2e hel1390/hel1304/hel1351: cleanup deletes check their status.
- Frontend chart fixtures use `xAxis`/`yAxis`/`series`/`annotation`.
- `AssistantProposalToolSchemasSpec` drops `asInstanceOf[JsString]`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `user-reference-integrity`: rate-window rows are removed with their user.
- `mcp-panel-composition-tools`: inert panel-level proposal fields are marked deprecated on every agent-facing surface.

## Non-goals

- Removing the fields from the wire (would break the backward-compatibility requirement and old callers).
- Other legacy flat fields (`chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `sort`, `orientation`):
  `chartType` has an internal first-run consumer; out of the ticket's scope.
- `helio-mcp/src/types.ts` (edited by parked PRs #986/#990) and the Review UIs' "Mapping" row: HEL-1547.
- Changing any other `NO ACTION` user FK (e.g. `assistant_daily_usage`).
- Item 5a (already fixed by HEL-1469, #918) and HEL-1301's user-residue half (already fixed).

## Impact

Backend migration (V133, must merge after V131/V132), schema files, assistant tool schema, helio-mcp, frontend tests,
three e2e specs, `docs/user-reference-inventory.md` (also edited by parked #994: one-line adjacent insertion).
