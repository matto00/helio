# HEL-1525: Return layoutVersion on panel-placement responses (avoid the extra 409 after an own panel create)

## Description

Follow-up from HEL-1457 (PR matto00/helio#980). The owner triaged it as standalone.

HEL-1457's web client keeps the `layoutVersion` the user's local layout is based on. It is never newer than that
layout (invariant I1). When a tab creates, duplicates or batch-creates a panel, the server bumps `layout_version`
through the V127 trigger. The tab, however, extends its baseline locally from the placement response, which carries
no version. As a result, the tab's next layout save after its own panel create always takes a 409, then a silent
rebase, then a retry: one extra round trip, plus a dashboard refetch.

## Acceptance criteria

- Panel create, duplicate and batch responses carry the dashboard's new `layoutVersion` alongside the placed items.
- The client advances its baseline version from that response only when the response layout is exactly baseline plus
  the placement, so I1 still holds. A concurrent writer's change in between must still cause a 409.
- A test shows that a create followed by a drag saves with a single 200 and no 409.
- An I1 regression test covers a concurrent writer racing the create.

## Driver notes (claims, verified at Setup)

- Stay out of `helio-mcp/` (HEL-1524 is in flight there). The batch response change is additive; coordinate through
  the PR body.
- Schema changes go in `schemas/` in the same change. No migration expected (V131 would be next free).
- `DELETE /api/panels/:id` (204, no body) also bumps the version via the V122 strip; it is NOT in this ticket's AC and
  is out of scope here (see proposal Non-goals; filed as a follow-up).

origin_kind: followup
origin_ticket: HEL-1457
