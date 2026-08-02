This is a design-investigation-only ticket (HEL-266). No production code changes ship. The
change touches only this OpenSpec change folder:

- `openspec/changes/cross-session-panel-invalidation-design/ticket.md` — ticket description,
  candidate approaches (A–D), and design questions carried over from Linear (HEL-266).
- `openspec/changes/cross-session-panel-invalidation-design/proposal.md` — why/what-changes/
  capabilities/impact for this design-only change (no spec deltas; documents that explicitly).
- `openspec/changes/cross-session-panel-invalidation-design/design.md` — context (including a
  correction to the ticket's stale ACL-asymmetry premise), decisions D1 (ship BroadcastChannel
  now), D2 (recommend scoped SSE `DataTypeRowRegistry`), D3 (defer polling/service-worker push),
  risks/trade-offs, and open questions.
- `openspec/changes/cross-session-panel-invalidation-design/tasks.md` — task checklist; section 3
  (spinoff tickets) completed this cycle, filing HEL-640, HEL-641, HEL-642 in Linear.
- `openspec/changes/cross-session-panel-invalidation-design/files-modified.md` — this file.
