## Why

`MessageComposer.tsx` stays mounted across an ordinary conversation switch (by design, since
HEL-695's fix removed the old per-state early-return remount). Its local `message` draft and
HEL-698's `pendingSend` idempotency pair are never reset when the `conversationId` prop changes,
so a draft typed in conversation A is still sitting in the composer after switching to B. Harmless
to send-idempotency (the key is scoped server-side per conversation), but a confusing, undeliberate
UX: the user has no way to tell whether that text is theirs-for-B or leftover-from-A.

## What Changes

- `MessageComposer` clears `message`, `error`, and `pendingSend` whenever `conversationId` changes
  to a value it did not itself just create.
- The one exception is preserved deliberately: when the composer itself creates a new conversation
  from the `conversationId === null` state (self-send flow) and the `conversationId` prop then
  flips from `null` to that new id mid-submit, the reset is skipped — the send already in flight
  against that id must keep its `sending`/`pendingSend`/`message` state, or HEL-695's "no dead
  moment during first-send" fix regresses.
- No change to `ActiveConversationPanel`'s mount structure, `pendingSend`'s retry semantics for a
  same-conversation retry, or the server-side idempotency-key comparison.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chat-message-composer`: adds a requirement that switching to a different, non-self-created
  conversation clears the composer's draft and pending-send state, with an explicit carve-out for
  the self-created-conversation transition so HEL-695's continuous-sending-indication behavior is
  preserved.

## Impact

- `frontend/src/features/assistant/ui/MessageComposer.tsx` — add a conversation-change-tracking
  effect plus a ref marking a self-created target id.
- `frontend/src/features/assistant/ui/MessageComposer.test.tsx` — new coverage for the reset-on-
  switch and skip-reset-on-self-create cases.
- No backend, schema, or API changes.

## Non-Goals

- Per-conversation draft persistence (a keyed map restoring each conversation's own draft) —
  considered and rejected for this pass; see design.md.
- Handling a user manually switching conversations while a send for the *previous* conversation is
  still in flight (a pre-existing race, unrelated to this fix, not covered by the AC).
