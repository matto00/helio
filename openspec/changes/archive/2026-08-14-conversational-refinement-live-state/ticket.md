# HEL-411: Multi-turn conversational refinement over live state (in-app chat + MCP)

## Description

This is the user-facing loop of Conversational Refinement: the user, looking at a live
dashboard/pipeline, says "make that a bar chart, group by month" or "drop the last panel," and the
agent reads the current live state, proposes a **patch set** (HEL-343 schema ticket), the user
previews it (HEL-343 diff-preview ticket, HEL-408), and applies it (HEL-343 apply ticket, HEL-406).
It must work in BOTH surfaces: the in-app chat (shared with HEL-341's chat surface) and the
external MCP.

Touches: the authoring/refinement service (Claude call grounded in live resource state + the
patch-set contract), the in-app chat surface (reuse HEL-341/HEL-395), the MCP
(`helio-mcp/src/tools/` — orchestrate HEL-328 PATCH primitives + the patch-set apply endpoint), and
the workspace-context grounding (HEL-345).

## Scope

- Backend Scala: a refinement endpoint that takes `{ target scope (dashboard/pipeline id), message,
  history[] }`, grounds Claude (HEL-341 client) in the current live state of the referenced
  resources + workspace context (HEL-345) + panel-capability menu (HEL-365), and returns a proposed
  `PatchSet` (validated, not applied). Multi-turn history like the HEL-341 authoring conversation.
  Non-blocking; no fully-qualified names inline.
- Reuse the HEL-341 conversation-state persistence (or share the store) rather than a parallel
  mechanism; enforce the same cost/token budget.
- In-app: extend the HEL-341 chat surface so a refinement turn targets the currently-open
  dashboard, shows the diff-preview, and applies via the patch-set apply path.
- MCP: a `propose_patch_set` / `refine` tool that assembles + returns a patch set (no writes) and an
  apply tool posting to the patch-set apply endpoint — so an external agent refines with the same
  atomic, reviewable primitive rather than firing raw HEL-328 PATCH calls one-by-one. Descriptions
  consistent with existing MCP prose.
- Tests: ScalaTest (mocked Claude) that a refinement message over a live dashboard yields a valid
  patch set targeting the right resources; MCP unit tests for the tools; Jest/RTL for the in-app
  refinement turn.

## Acceptance Criteria

- [ ] A refinement message over a live dashboard/pipeline yields a validated `PatchSet` grounded in
      current state, in both the in-app chat and MCP surfaces.
- [ ] The in-app flow shows the diff-preview and applies via the patch-set apply endpoint; nothing
      is written until the user accepts.
- [ ] The MCP exposes propose + apply patch-set tools (atomic, reviewable) rather than only raw
      per-resource PATCH calls.
- [ ] Multi-turn history + cost/token budget reuse the HEL-341 conversation infrastructure (no
      parallel store).
- [ ] Grounding uses HEL-345 context + HEL-365 capabilities.
- [ ] `sbt test` (mocked Claude) + MCP tests + `npm test` + lint/format green.
- [ ] Backward-compat: additive; existing chat authoring + MCP tools unchanged.

## Out of Scope

- The patch-set schema, apply, and diff-preview primitives (sibling tickets, consumed here —
  HEL-403/406/408, all already shipped).
- Undo (sibling ticket, HEL-413).
- The HEL-328 PATCH primitives themselves (already shipped).

## Dependencies

- Blocked by HEL-328 (shipped). Depends on the HEL-343 patch-set schema/apply/preview tickets
  (HEL-403/406/408, all shipped), the HEL-341 Claude client + chat surface + conversation state
  (shipped), and HEL-345 grounding (shipped). Related to HEL-365 and the HEL-341 chat tickets
  (shared chat surface).
