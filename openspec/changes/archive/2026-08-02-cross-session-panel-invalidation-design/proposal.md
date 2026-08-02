## Why

HEL-242 fixed same-tab, same-user panel staleness after a pipeline run. Three gaps remain:
cross-tab (same browser, two tabs), cross-user (dashboard sharing), and future row writers that
bypass the narrow fix's client-side invalidation path entirely. This ticket is investigation-only:
produce a design proposal so a follow-on ticket can scope implementation cleanly.

## What Changes

- No production code changes in this ticket.
- Adds `design.md` evaluating four candidate approaches (SSE broadcast, BroadcastChannel API,
  polling fallback, service-worker push) against the three gaps, with LOC/infra/test-surface
  cost estimates for each.
- Resolves the five open design questions from the ticket (subscription ACL stance, connection
  scaling, server lifecycle/cleanup, multi-instance horizon, backwards compatibility).
- Produces a recommendation (single approach, hybrid, or "punt") and spinoff implementation
  ticket(s) with concrete scope, filed in Linear.

## Capabilities

### New Capabilities

(none — this change produces a design document only; no new capability ships in this ticket)

### Modified Capabilities

(none — no spec-level behavior changes in this ticket; any resulting spec changes belong to
the spinoff implementation ticket(s))

## Impact

- Affected docs: this change's `openspec/changes/cross-session-panel-invalidation-design/`
  folder only (proposal, design, tasks) — no `openspec/specs/` deltas.
- Affected code: none directly. Design references `PipelineRunService`, `dataTypeRowRepo`,
  `PanelService.resolveBindingsForRead`, `/api/types/:id/rows`, and the `PipelineRunRegistry`
  SSE pattern (PR #156) as existing systems the design must be consistent with.
- Downstream: one or more spinoff Linear tickets carrying the actual implementation scope.

## Non-goals

- No implementation of any candidate approach in this ticket.
- No changes to HEL-242's shipped behavior.
- No generalizing invalidation beyond DataType rows (panel layouts, comments, etc. are out of
  scope, per the ticket).
