# HEL-711: MessageComposer keeps its draft and idempotency-key state across conversation switches

## Description

### Observed (flagged by HEL-698's final-gate skeptic; pre-existing, not introduced by HEL-698)

`MessageComposer.tsx`'s local state — the typed draft (`message`) and, since HEL-698, the
`pendingSend` `{key, text}` idempotency pair — is not reset when the `conversationId` prop
changes. The component instance stays mounted across an ordinary conversation switch (no
`key={conversationId}` remount, no reset effect), so a draft typed in conversation A is still
sitting in the composer after switching to conversation B.

Harmless to send-idempotency: the key comparison is scoped to the conversation row server-side,
so a stale key reused against a different conversation is just an opaque unmatched UUID — never
a false replay. This is purely a UX question.

### Design question (small pass, not a one-liner)

Should a draft follow the user across conversations? Candidate directions: clear draft +
`pendingSend` on `conversationId` change; or per-conversation draft persistence (keyed map,
lifted state). Decide deliberately rather than picking whichever is easiest.

### Relationship to HEL-695 (related, NOT a duplicate)

HEL-695 is the opposite failure in the null-conversation *first-send* path: an
`ActiveConversationPanel` branch switch **remounts** the composer and **loses** live
`sending`/`message` state mid-flight. This ticket is the same mounted instance **keeping** stale
state across an ordinary switch. Distinct root causes (remount vs. missing reset), but the fixes
pull in opposite directions — e.g. HEL-695's "lift state to Redux so it survives" could worsen
this ticket's stale-state persistence if not scoped per-conversation, and a naive clear-on-switch
here could re-trigger HEL-695's dead-moment during the first-send branch flip. Worth solving in
one small design pass together.

## Acceptance Criteria

- [ ] Switching conversations presents a composer state that is deliberate (cleared, or restored
      per-conversation) — never another conversation's leftover draft by accident.
- [ ] The chosen behavior does not regress HEL-695's continuous-sending-indication AC, and vice
      versa.

## Links

- https://linear.app/helioapp/issue/HEL-711/messagecomposer-keeps-its-draft-and-idempotency-key-state-across
- Related: HEL-698 (https://linear.app/helioapp/issue/HEL-698/chat-send-can-succeed-server-side-while-the-client-reports-failure)
- Related: HEL-695 (https://linear.app/helioapp/issue/HEL-695/messagecomposer-loses-its-sending-state-when-starting-a-new)
