# HEL-662: AssistantService: wire tool loop + find/get_resource + propose_* into one entry point

## Description

The core of HEL-659: a new `AssistantService` that supersedes `DashboardAuthoringService` as the
in-app assistant's entry point, reusing its validation/proposal-construction logic rather than
discarding it. See `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md` for the full
turn shape.

Depends on: the tool-use loop primitive ticket (HEL-660, merged), the find/get_resource ticket
(HEL-661, merged). `propose_patch_set` specifically depends on HEL-343's patch-set apply path
(HEL-406) — per research at planning time, HEL-406 (and its successors HEL-408 preview, HEL-413
undo) are already fully merged to main, so this dependency is no longer a blocker; `propose_patch_set`
ships in this ticket, not deferred.

## Scope

* `AssistantService.converse(conversationId, message)` — loads conversation history + static system
  prompt, runs the bounded tool-use loop with tools `[find, get_resource, propose_dashboard,
  propose_pipeline, propose_combined, propose_patch_set]`.
* `propose_*` tools are thin wrappers around the already-shipped `DashboardProposalService`/
  `CombinedProposalService`/`PipelineProposalService` (+ patch-set service) — no new mutation logic.
* **Hard boundary: no `apply` tool.** Applying a proposal stays a separate, explicit user action in
  the existing Proposal Review UI. The assistant must never be able to mutate the workspace
  unilaterally.
* System prompt: static guardrail text (role, available tools, the 3-hop cap stated explicitly, the
  propose-never-apply boundary), carrying forward HEL-401's guardrail wording.
* Streaming/event shape for the frontend: needs new event types for tool-call/search progress, not
  just the old text/proposal events `useDashboardAuthoringStream` expects today.

## Acceptance Criteria

- [ ] Given a goal answerable from existing workspace data, `AssistantService` produces the same
      quality of `DashboardProposal` `DashboardAuthoringService` would have, via the tool loop.
- [ ] Given a goal with no existing matching DataType, `AssistantService` falls back to
      `propose_pipeline`/`propose_combined` instead of failing — this should require no
      special-case code, just the system prompt + tool availability.
- [ ] No code path in this service can call an apply/mutate endpoint directly — enforced by the
      tool schema itself not including one, and covered by a test asserting the tool list never
      contains an apply-shaped tool.
- [ ] `sbt test` fully green, zero real network calls in the automated suite.

## Context / Notes

- Parent epic: HEL-659. Third of 8 child tickets; delivery order 660 (merged) → 661 (merged) → 662
  (this ticket) → 663 (conversation persistence) → 664 → 665 → 666 → 667.
- **Scope boundary decision (self-approved, see design.md Planner Notes): conversation persistence
  is HEL-663's job, not this ticket's.** No `assistant_conversations` table or equivalent exists yet
  (confirmed at planning time). `converse` in this ticket takes an explicit, caller-supplied message
  history parameter rather than performing its own DB-backed `conversationId` lookup, so HEL-663 can
  slot a real history-loading step in front of this ticket's loop mechanics without reshaping them —
  mirrors the ticket's own precedent for HEL-406 ("ship without it initially... add once it lands
  rather than blocking this ticket"), applied here to the one dependency that similarly isn't ready.
- **Critical design constraint identified at planning time**: `PipelineProposalService` and
  `CombinedProposalService` currently expose only a mutating `apply` — no non-mutating validate/
  preview entry point (unlike `DashboardProposalService.validate`, which already exists specifically
  for this "reject before creating" purpose, per its own doc comment). Satisfying this ticket's Hard
  Boundary requires adding non-mutating `validate` methods to both, not calling `apply` from any
  `propose_*` tool. `propose_patch_set` is unaffected — `PatchSetPreviewService.preview` already
  exists and is already non-mutating (HEL-408).
