# HEL-1203: PATCH /api/panels/:id: malformed output-panel controls return 500; duplicate control ids accepted; controls silently ignored on non-output panels

## Description
Found during HEL-1193 (evaluator re-confirmed the 500 live). origin_kind: followup, origin_ticket: HEL-1193.

Defects (pre-existing on main, on `PATCH /api/panels/:id` with `config.controls`):
- A control missing `id`, a non-array `controls`, or a non-object element returns HTTP 500 instead of a 4xx (strict `OutputControlSpec` decoder error not mapped on the PATCH path).
- Duplicate control ids are accepted (200) and persisted; `OutputControlsValidator` only checks column/kind.
- PATCH `config.controls` on a text (non-output) panel returns 200 and silently ignores the controls.

Also: no backend test pins that `DashboardContentsService` (PUT contents) and `ApiRoutes` wire `outputControlsValidator` into `DashboardProposalService`/`DashboardContentsService`; the parameter is nullable-optional so dropping the wiring silently skips propose-time validation.

## Acceptance Criteria
- Each defect above is reproduced red on main, then fixed (4xx with a clear message; duplicate ids rejected; non-output controls rejected).
- Every other write path that stores panel `config.controls` (create, batch create, duplicate, import, proposal apply, patch-set apply, contents replace, MCP control tools) is enumerated from code and checked for the same three defects; same error shape everywhere.
- A backend test fails if the `outputControlsValidator` wiring is removed from `ApiRoutes` -> `DashboardProposalService`/`DashboardContentsService`; shown by mutation.
- HEL-1002 404 behaviour and ExistenceNotLeakedRoutesSpec not regressed.
