# HEL-397: Multi-turn conversation state: refine the proposal before applying

## Description

The single-shot authoring endpoint (HEL-392, shipped) turns one goal into one proposal. Users will want to iterate before applying — "make the second panel a bar chart," "add a totals metric," "drop the table" — with the model refining the *same* proposal across turns rather than starting over. That requires carrying conversation state (prior messages + the current working proposal) across requests.

This ticket adds multi-turn conversation state to the authoring flow: the endpoint accepts prior turns + the working proposal and returns the revised, re-validated proposal; the chat surface (HEL-395, shipped) drives the loop. This is the pre-apply refinement case, distinct from HEL-343's refinement of already-applied live resources.

Touches: the authoring service/endpoint (extend to accept conversation history), a conversation-state store (see Flyway note), the chat UI (multi-turn thread), and `dashboardsSlice`/a chat slice for client state.

## Scope

* Backend Scala: extend the authoring endpoint to accept `{ conversationId?, history[], workingProposal?, message }` and return the revised proposal + updated history, re-validating every turn with the shared apply-path validation. Enforce the per-request AND per-conversation cost/token budget (HEL-390's `com.helio.ai.ClaudeClient` guardrails) so a long thread can't run away.
* Persistence: store authoring conversations (turns + working proposal snapshot) server-side keyed to the user, so a session survives a reload. **Flyway migration: next available VNN, assigned at scheduling time** — verify the actual current head migration in this worktree at planning time, do not trust any number written here as of ticket authoring. RLS-scoped to the owner.
* Frontend TS: multi-turn thread UI on the chat surface; each turn updates the working proposal preview; "review & apply" hands the latest working proposal to the existing `ProposalReview` flow.
* Bound the retained history (token budget) — summarize/trim older turns deterministically (coordinate with HEL-345's token-budget approach).
* Tests: ScalaTest for a multi-turn refine (turn 2 edits the turn-1 proposal, re-validated) with a mocked Claude client; conversation persistence + RLS; Jest/RTL for the thread UI.

## Acceptance criteria

- [ ] The authoring endpoint accepts conversation history + a working proposal and returns a revised, re-validated proposal each turn.
- [ ] Conversations persist server-side (owner-scoped, RLS) and survive a reload; new Flyway migration uses the next available VNN (not hardcoded).
- [ ] Per-conversation cost/token budget enforced; retained history is bounded deterministically.
- [ ] The chat surface shows the multi-turn thread and updates the working-proposal preview; apply still routes through the existing review + `applyProposal` path.
- [ ] `sbt test` (mocked Claude) + `npm test` + lint/format green.
- [ ] Backward-compat: single-shot authoring (no history) still works; additive fields only.

## Out of scope

* Refining already-applied resources (HEL-343 conversational refinement).
* The base single-shot endpoint + chat surface (sibling tickets, HEL-392/HEL-395, both shipped).

## Dependencies

* Depends on the HEL-341 NL authoring endpoint + chat-surface tickets (HEL-392, HEL-395, both shipped) and the Claude client (HEL-390, shipped). Related to HEL-343 (shares the chat surface + refinement concept). Bears a Flyway migration.
