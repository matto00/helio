# HEL-1193: MCP + proposal surface for output panel controls

## Description

Leaf 5 of HEL-915 (re-scoped 2026-09-29 with the owner, see the epic).

### Why

The epic's exit criterion requires that an agent can build the same thing a human can: add a date-range control to an Output panel. Helio is agent-native (PAT auth + helio-mcp + apply-proposal), so controls need to exist on that surface too, not only in the UI.

### Scope

* helio-mcp: agents can add, update and remove controls on an output panel (extend `update_panel` / `place_outputs`, or add a tool; decide), read an Output's filter capability contract (HEL-1188), and see a panel's configured controls.
* `get_workspace_context` lists each output panel's controls.
* Proposal paths (`propose_dashboard` / combined / patch-set): a proposal can declare controls, validated against the capability contract exactly as HEL-1189's server validation does, never a separate rule set.
* Tool copy and docs match the backend's actual status codes. (HEL-1143 found helio-mcp documenting 400 where the backend returns 422; don't repeat that.)

### Out of scope

Viewer selections (URL-held, per viewer; not an agent concern), dashboard variables (v0.9, HEL-1192).

## Acceptance Criteria

* Via MCP alone, an agent adds a date-range control to an existing Output panel, auto-bound to its date column, and a human viewer sees it in the UI.
* An agent proposing a control the contract disallows gets the same defined error the UI path gets.
* `get_workspace_context` output includes controls. Schema/tests updated.
* helio-mcp tests cover each new or extended tool.
