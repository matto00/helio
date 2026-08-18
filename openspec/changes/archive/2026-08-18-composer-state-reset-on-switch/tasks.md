## 1. Frontend

- [x] 1.1 Add `prevConversationIdRef` and `selfCreatedIdRef` refs to `MessageComposer`.
- [x] 1.2 Set `selfCreatedIdRef.current = targetId` immediately before dispatching
      `setSelectedConversationId(targetId)` in the null-conversation self-send branch of
      `handleSubmit`.
- [x] 1.3 Add a `useEffect([conversationId])` that, on a genuine change (compared against
      `prevConversationIdRef`), clears `message`/`error`/`pendingSend` unless the new
      `conversationId` matches `selfCreatedIdRef.current` — in which case it skips the reset and
      consumes (nulls out) the ref instead. Update `prevConversationIdRef` unconditionally.
- [x] 1.4 Update `MessageComposer`'s doc comment to describe the reset-on-switch contract and the
      self-created-transition carve-out (design.md D1/D2).

## 2. Tests

- [x] 2.1 Test: a typed draft is cleared when `conversationId` changes to a different existing id.
- [x] 2.2 Test: a failed send's preserved draft + pending-send key are cleared on switching to a
      different conversation (a subsequent send from the new conversation mints a fresh key).
- [x] 2.3 Test: the null-conversation self-send flow (mocked `createConversation`) preserves
      `sending`/draft/pending-send state through the `conversationId: null -> newId` transition —
      no regression of HEL-695's continuous-sending-indication behavior.
- [x] 2.4 Run `npm run lint` and `npm test -- --testPathPattern=MessageComposer` from `frontend/`;
      fix any failures before handoff.
