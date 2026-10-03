## Why

`PATCH /api/panels/:id` with malformed `config.controls` returns 500, accepts duplicate control ids, and silently ignores `controls` on non-output panels. The repo stance is "never silently drop"; a client error must be a 4xx. The propose-time validator wiring is also unpinned by any test.

## What Changes

- Map `OutputControlSpec`/`OutputPanelConfig.Patch` decode failures on the panel PATCH path to a 400 with the decoder's message.
- Reject duplicate control ids (400) on every write path that stores `config.controls`.
- Reject `config.controls` supplied for a non-output panel (400) instead of silently ignoring it (matches the existing proposal-path rule "controls are only supported on an output panel").
- Audit every other controls write path (create, batch create, duplicate, import, proposal apply, patch-set apply, contents replace, MCP) and apply the same three rules with one shared error shape.
- Add a wiring test pinning `outputControlsValidator` into `DashboardProposalService` and `DashboardContentsService` via `ApiRoutes`, proven by mutation.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-panel-placement`: controls writes reject malformed controls, duplicate ids, and controls on non-output panels with a 400.

## Impact

Backend only: `PanelService`, `OutputPanel` domain validation, possibly `ProposalPanelSupport`/patch-set apply/import, `ApiRoutes` wiring test. No schema or migration change expected.
