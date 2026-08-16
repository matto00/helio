# HEL-576: Surface assertion results in Run History + panel invalid/stale badge

## Description

Assertion results (419-B / HEL-509) are only useful if a user can SEE them. This ticket surfaces per-run assertion outcomes in the Run History UI and puts an invalid/stale indicator on panels bound to a DataType whose latest run had failing assertions — closing the trust loop for "alive" dashboards.

Run history UI is `frontend/src/features/pipelines/ui/RunHistoryModal.tsx`; run-history data comes from `PipelineRunService.history` → `PipelineRunRecord` (via `PipelineRunHistoryRoutes`).

## Scope

* Backend response: extend `PipelineRunRecord` (and its protocol/schema) with an assertion summary per run — counts of passed/failed by severity, and the failing rules' messages — sourced from 419-B's `listAssertionsByRun`.
* Run History UI: in `RunHistoryModal.tsx`, show each run's assertion summary (e.g. "3 passed, 1 error, 0 warn") with an expandable list of failing rules. Follow `DESIGN.md` tokens/components.
* Panel badge: add an "invalid" / "stale" indicator to panels whose bound DataType's most recent run had `error`-severity assertion failures (or was blocked per 419-C). Determine the cleanest data path (panel render already knows the bound `dataTypeId`; expose a small "latest run assertion status" read for a DataType, or piggyback existing panel/data-type reads). Keep it non-blocking — the badge is informational.
* Typed APIs; Jest tests; `sbt test` for the response change.

## Acceptance criteria

- [ ] Each run in Run History shows a pass/fail-by-severity assertion summary with the failing rules' messages expandable.
- [ ] A panel bound to a DataType whose latest run had error-severity assertion failures (or was blocked) shows an invalid/stale badge; a clean run shows none.
- [ ] Backend `PipelineRunRecord` + its JSON Schema carry the assertion summary; additive/backward-compatible.
- [ ] UI follows `DESIGN.md`; `npm run lint` (zero warnings) + `npm test` + `sbt test` pass.

## Out of scope

* The evaluation/persistence itself (419-B) and blocking policy (419-C).
* MCP/agent surfacing (419-F).

## Dependencies

* Blocked by 419-B (HEL-509) — merged. Reads better after 419-C (HEL-570, blocked-run status) — also merged.
