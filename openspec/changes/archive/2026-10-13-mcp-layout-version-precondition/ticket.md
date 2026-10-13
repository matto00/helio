# HEL-1524: helio-mcp: send expectedLayoutVersion on dashboard layout writes

## Description

Follow-up from HEL-1457 (PR matto00/helio#980). The owner triaged it as standalone.

HEL-1457 added `layoutVersion` to every dashboard response. It also added an optional `expectedLayoutVersion`
precondition to `PATCH /api/dashboards/:id` and `POST /api/dashboards/:id/auto-layout`, which returns 409
`{message, dashboard}` on a mismatch.

The web client always sends the precondition. helio-mcp does not yet. Without it, the server does a bounded
compare-and-set retry against the version it read. That means a stale agent can still replace a whole breakpoint it
sends, and so drop placements made concurrently by a browser tab or another agent.

## Acceptance criteria

* helio-mcp's dashboard `Dashboard` type includes `layoutVersion`.
* Layout-writing tools (dashboard layout PATCH, auto-layout) send `expectedLayoutVersion` taken from the dashboard the
  agent last read.
* On a 409, the tool surfaces the conflict to the agent with the current dashboard from the response body, or re-reads
  and reapplies. It must never retry blindly without the precondition.
* Tests cover the 409 path.
* Optional, after this ships: decide whether the server should require the precondition. This is an owner call.

origin_kind: followup
origin_ticket: HEL-1457
