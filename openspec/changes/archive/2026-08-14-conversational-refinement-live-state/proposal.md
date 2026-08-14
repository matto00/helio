## Why

A user looking at a live dashboard should be able to say "make that a bar chart, group by month" and
get a reviewable, atomic edit — not a fresh proposal, and not raw per-field PATCH calls. HEL-343's
sibling tickets already built the artifact (`PatchSet`, HEL-403), the apply path (HEL-406), and the
diff preview (HEL-408). This ticket closes the loop: the conversational turn that PRODUCES a `PatchSet`
grounded in a resource's current live state, reachable from both the in-app chat and the MCP.

## What Changes

- New backend `POST /api/refinements`: takes `{ target: {kind: dashboard|pipeline, id}, message,
  conversationId? }`, grounds Claude in the target's live state (existing repos/services) +
  workspace context (HEL-345) + panel capabilities (HEL-365), and returns a `PatchSet` already
  proven valid by running it through `PatchSetPreviewService.preview` (HEL-408) before responding —
  the SAME reuse-the-apply-path's-own-validation pattern `DashboardAuthoringService` already uses
  for `DashboardProposal`. Never applies anything itself.
- `authoring-conversation-state` (HEL-397) generalized: `authoring_conversations` gains a nullable
  `latest_patch_set` column alongside `latest_proposal`, and `AuthoringConversationTurns` gains a
  patch-set-outcome variant — ONE shared conversation store for both flows (no parallel table).
- New in-app `RefinementChatDrawer` (sibling to `AuthoringChatDrawer`, same visual/streaming
  pattern), launched from an already-open dashboard. A successful turn hands the returned `PatchSet`
  to the existing `/patch-sets/review` route (HEL-408's own `location.state.patchSet` hook) —
  nothing is written until the user accepts there.
- New `helio-mcp` tools: `propose_patch_set` (calls the new endpoint, read-only) and
  `apply_patch_set` (posts to the existing HEL-406 `/api/patch-sets/apply`), so an external agent
  refines through the same atomic, reviewable primitive instead of raw HEL-328 PATCH calls.

## Capabilities

### New Capabilities

- `conversational-refinement`: the backend refinement endpoint — grounds Claude in live
  dashboard/pipeline state and returns a validated `PatchSet`, never applying it.
- `refinement-chat-surface`: the in-app chat drawer that turns a message about the currently-open
  dashboard into a previewed, reviewable patch set.
- `mcp-patch-set-tools`: the MCP `propose_patch_set` / `apply_patch_set` tool pair.

### Modified Capabilities

- `authoring-conversation-state`: the shared conversation store now persists either a
  `DashboardProposal` OR a `PatchSet` as a conversation's latest outcome, not `DashboardProposal`
  only.

## Impact

Backend: new service/route/migration, `AuthoringConversationRepository`/`AuthoringConversationTurns`
generalized. Frontend: new drawer component + trigger, reuses `/patch-sets/review` unmodified.
`helio-mcp`: two new tools. No existing route, protocol, or component behavior changes for callers
that don't opt into refinement.

## Non-Goals

- Undo (sibling ticket, HEL-413).
- The patch-set schema/apply/preview primitives themselves (already shipped: HEL-403/406/408).
- An in-app trigger for pipeline refinement — no pipeline page has an equivalent "live view" surface
  to anchor a drawer to today; pipeline refinement is fully supported by the backend endpoint and MCP,
  just not from an in-app chat entry point yet.
