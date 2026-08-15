## REMOVED Requirements

### Requirement: A user can open the chat surface, submit a goal, and see a streamed response
**Reason**: `AuthoringChatDrawer` (the chat surface this requirement describes) is deleted — HEL-659
is a big-bang replacement of the old NL-authoring drawer, not a parallel rollout alongside the new
top-level assistant.
**Migration**: The new chat surface's message rendering (`chat-message-rendering` capability) and
its bounded tool-use loop (`assistant-conversation-loop`) cover the successor behavior — a live
send-and-respond flow, buffered rather than streamed (no SSE variant in the new architecture).

### Requirement: A terminal result hands the proposal to the existing Proposal Review UI unmodified
**Reason**: Same as above — the drawer that performed this hand-off no longer exists.
**Migration**: `chat-message-rendering`'s proposal hand-off requirement (`ProposalHandoff`) covers
the successor behavior, reusing the identical `navigate(..., {state: {proposal}})` mechanism this
requirement originally described.

### Requirement: Nothing is written until the user explicitly accepts in the review UI
**Reason**: Same as above.
**Migration**: The propose-never-apply invariant is now enforced at the assistant's tool-schema
level (`assistant-conversation-loop`'s "no apply-shaped tool" requirement) — a stronger guarantee
than the old drawer's own discipline, since no apply-capable tool is ever offered to the model at
all, not just never called by the drawer's own code.

### Requirement: A terminal error or connection failure surfaces inline without navigating away
**Reason**: Same as above.
**Migration**: `chat-message-rendering`'s tool-call error handling (`isError` results rendered with
DESIGN.md's error-intent tokens) and the live-converse endpoint's own error-status mapping
(`assistant-live-converse`) cover the successor error-surfacing behavior.

### Requirement: An intermediate repair status is surfaced, not raw mid-stream JSON
**Reason**: Same as above — this requirement was specific to the old single-shot parse/validate/
repair flow, which the new bounded tool-use loop does not have (tool-execution errors are fed back
to Claude directly, not surfaced as a client-visible "repairing" status).
**Migration**: None — this specific mid-stream repair concept has no successor; the new
architecture's error handling (`chat-message-rendering`) is the relevant replacement capability.

### Requirement: A discoverable entry point opens the chat surface
**Reason**: The "Author with AI" affordance in `DashboardList.tsx` is deleted per this ticket
(HEL-666) — replaced by the single global entry point principle the whole epic is built around.
**Migration**: `chat-quick-launcher`'s command-bar trigger (available on every authenticated route)
and the `assistant-chat-nav` capability's `/chat` nav destination are the two entry points that
replace every per-feature button, including this one.
