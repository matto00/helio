## Context

`MessageComposer.tsx` holds four pieces of local state: `message`, `sending`, `error`, and
`pendingSend` (`{key, text}`, HEL-698). It is rendered as the stable last child of
`ActiveConversationPanel`'s single content tree (HEL-695's F-021 fix) — deliberately never
remounted via `key={conversationId}`, because remounting was exactly what discarded the
`sending`/`message` state mid-flight during the null-conversation first-send transition.

`conversationId` changes for two different reasons:
1. **An ordinary switch** — the user picks a different conversation from the sidebar (or the
   quick-launcher), and `effectiveId` in `ActiveConversationPanel` flips to that conversation's id.
2. **A self-created transition** — the composer itself, mid-`handleSubmit`, calls
   `createConversation()` and dispatches `setSelectedConversationId(targetId)` while
   `conversationId` was `null`. `effectiveId` flips from `null` to `targetId` as a *side effect of
   the send already in progress*, not a user-initiated switch.

Case 1 is this ticket's bug: nothing resets the draft, so it leaks across the switch. Case 2 must
NOT be treated the same way — resetting on that transition would wipe `pendingSend` (breaking the
retry-key reuse this call is depending on) and blank the input/error state out from under an
in-flight send, which is the "vice versa" regression the ticket calls out against HEL-695.

## Goals / Non-Goals

**Goals:**
- Reset `message`, `error`, and `pendingSend` when `conversationId` changes to a value the
  component did not itself just create via the null-conversation self-send flow.
- Never regress HEL-695's continuous-sending-indication behavior for the self-created transition.

**Non-Goals:**
- Per-conversation draft persistence (see Decisions — rejected for this pass).
- Handling a user switching away from a conversation whose send is still in flight (pre-existing,
  not in the AC — the returning promise's `setSending(false)`/`setMessage("")`/`setError(...)`
  calls already apply to whatever conversation is current when they land; this ticket does not
  change that behavior, only adds a new reset trigger for the ordinary-switch case).

## Decisions

### D1: Clear-on-switch, not per-conversation persistence

Two candidate directions were named in the ticket: (a) clear the draft on switch, (b) persist a
draft per conversation (a keyed map, restored on return to that conversation).

Chosen: **(a) clear on switch**, scoped to exclude the self-created transition (D2).

Rationale:
- The AC's own framing treats "cleared" as the first-listed, simplest acceptable outcome —
  "never another conversation's leftover draft by accident" is the hard requirement; persistence
  is only offered as an alternative deliberate behavior, not a preference.
- Per-conversation persistence needs its own state shape (a `Record<conversationId, {message,
  pendingSend}>`) that has to be bounded (unbounded growth across a long-lived session with many
  conversations) and reconciled with conversation deletion — real additional scope the ticket
  frames as "small pass, not a one-liner," not "add a new persistence subsystem."
- Persistence would also widen the surface `pendingSend` has to reason about: a stale key sitting
  in a per-conversation slot could be resurrected on return to that conversation arbitrarily long
  after the failed send, which is a materially different (and unreviewed) retry-semantics
  question from the one HEL-698 designed for (retry immediately after a failure, same session).
- Clearing is the behavior every other piece of local composer state (`sending`, `error`) already
  implicitly assumes when the component was first written un-conversation-scoped — extending that
  same assumption to `message`/`pendingSend` is the smaller, more consistent change.

### D2: Distinguish "self-created" from "ordinary switch" via a ref, not a broader signal

The component cannot tell, from `conversationId` alone, why it changed. Two refs track this:

- `prevConversationIdRef` — the last `conversationId` seen, so the reset effect can detect an
  actual change (as opposed to firing on every render).
- `selfCreatedIdRef` — set to `targetId` immediately before `handleSubmit` dispatches
  `setSelectedConversationId(targetId)` in the null-conversation branch. The reset effect checks
  this ref first: if the new `conversationId` matches it, the transition is self-created — skip
  the reset and clear the ref (one-shot, consumed).

Alternatives considered:
- **A `sending` guard instead of a dedicated ref** (skip reset whenever `sending` is true): rejected
  — `sending` is also true during an ordinary in-flight send on the conversation the user is
  currently viewing, so it doesn't distinguish "this id-change is caused by MY submit" from
  "an unrelated switch happened to land while unrelated work is pending." Only a small window
  differs in practice today (nothing currently changes `conversationId` while `sending` is true
  from a different cause), but a dedicated ref is precise regardless of that fact, at zero extra
  cost.
- **Comparing `pendingSend` against the new conversation**: rejected — `pendingSend` doesn't carry
  a conversation id, and adding one only to support this comparison is more surface than the
  single ref.

### D3: Effect fires on `conversationId` change, not inside `handleSubmit`

A `useEffect([conversationId])` is the natural place to react to a prop change regardless of what
caused it (sidebar click, quick-launcher selection, browser back/forward if ever wired) — it does
not need to know about every caller of `setSelectedConversationId`, only about the ref D2 sets.

## Risks / Trade-offs

- [Risk] A future caller changes `conversationId` for some other self-initiated reason without
  setting `selfCreatedIdRef` → its draft/pendingSend would be reset unexpectedly.
  → Mitigation: the only self-initiated transition in the component today is the null-conversation
  create-then-select flow; the ref is set at that single call site, and this design doc records the
  contract so a future change extending self-initiated transitions is expected to update it too.
- [Risk] A user manually switches conversations while a send for the *previous* one is still in
  flight; that promise's `finally`/`catch` handlers still fire and touch state that the reset
  effect already cleared for the *new* conversation, potentially showing that stale result against
  the wrong conversation. → Mitigation: pre-existing behavior (already true before this change,
  since the composer was never remounted), not in the AC, not made worse by this change — left as
  a known follow-up candidate, not fixed here.

## Planner Notes

Self-approved: implementing via two `useRef`s plus a `useEffect` inside `MessageComposer` rather
than introducing new Redux state — this stays a purely local-component concern (no other component
reads the draft or `pendingSend`), consistent with the existing all-local state shape.
