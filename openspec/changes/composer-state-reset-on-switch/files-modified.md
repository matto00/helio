- `frontend/src/features/assistant/ui/MessageComposer.tsx` — add `prevConversationIdRef` and
  `selfCreatedIdRef` refs plus a `useEffect([conversationId])` that clears `message`/`error`/
  `pendingSend` on a genuine `conversationId` change, except for the composer's own self-created
  null→newId transition (marked via `selfCreatedIdRef`, set immediately before the
  `setSelectedConversationId` dispatch in the null-conversation send branch); updated the doc
  comment to describe the reset-on-switch contract and the carve-out (design.md D1/D2).
- `frontend/src/features/assistant/ui/MessageComposer.test.tsx` — new `describe("reset on
  conversation switch (HEL-711)")` block: (1) a typed draft is cleared on switch to a different
  existing conversation, (2) a failed send's preserved draft + pending-send key are cleared on
  switch, with a subsequent send from the new conversation minting a fresh idempotency key, (3) the
  null-conversation self-send flow preserves `sending`/draft/pending-send state through its own
  `conversationId: null -> newId` transition (no regression of HEL-695).
