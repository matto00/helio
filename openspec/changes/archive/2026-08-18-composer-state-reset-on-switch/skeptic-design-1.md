## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/chat-message-composer/spec.md` in full (all under
  `openspec/changes/composer-state-reset-on-switch/`).
- Cross-checked every factual claim in `design.md`'s "Context" section against the actual
  current source, not just the design doc's narrative:
  - `frontend/src/features/assistant/ui/MessageComposer.tsx` (140 lines, read in full) —
    confirmed the four pieces of local state (`message`, `sending`, `error`, `pendingSend`,
    lines 71-74), confirmed `handleSubmit`'s null-conversation branch creates a conversation
    and dispatches `setSelectedConversationId(targetId)` at line 96 exactly where `design.md`
    D2/`tasks.md` 1.2 says the new ref should be set, and confirmed no existing `key={...}`
    remount or reset-on-prop-change effect exists today (the bug is real, not already fixed).
  - `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` — confirmed `MessageComposer`
    is rendered as the single stable last child (never remounted via `key={conversationId}`,
    per the HEL-695/F-021 comment at lines 44-57) and confirmed `effectiveId` derivation
    (line 76-78: `startingNewConversation ? null : (selectedConversationId ?? items[0]?.id ?? null)`).
  - `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — confirmed
    `setSelectedConversationId` resets `startingNewConversation = false` (line 218), which is
    required for the design's self-created transition (`null -> targetId`) to actually flip
    `effectiveId` the way `design.md`'s Context section assumes.
  - `openspec/specs/chat-message-composer/spec.md` (base spec, pre-change) — confirmed no
    existing requirement already covers draft-clearing-on-switch, so the delta's
    `## ADDED Requirements` header is correct (not a case that should have been `MODIFIED`).
  - `frontend/src/features/assistant/ui/MessageComposer.test.tsx` and
    `frontend/src/test/renderWithStore.tsx` — confirmed the existing test harness
    (`renderWithStore` returns a standard RTL `render()` result, including `rerender`) can
    support the new prop-change tests `tasks.md` 2.1-2.3 call for without further scaffolding.

### Design-soundness checks

- **Placeholders/hand-waving**: none found. `tasks.md` names the exact two refs, the exact
  call site for setting `selfCreatedIdRef`, and the exact effect logic; no `TODO`/`TBD`/deferred
  decisions.
- **Internal contradictions**: none — `proposal.md`, `design.md`, `tasks.md`, and the spec delta
  describe the same behavior (clear-on-switch with a self-created carve-out) consistently, and
  the spec delta's scenarios map 1:1 onto `tasks.md`'s test list (2.1↔scenario 1, 2.2↔scenario 2,
  2.3↔scenario 3).
- **Ambiguity**: `tasks.md` 1.1-1.3 are concrete enough that two competent implementers would
  converge on the same code. One minor underspecification: neither `design.md` nor `tasks.md`
  states how `prevConversationIdRef` should be initialized (`useRef(conversationId)` vs.
  `useRef(null)`). I traced the consequence either way — since `message`/`error`/`pendingSend`
  are already empty on mount, an accidental "genuine change" detection on the very first render
  resets already-empty state (no observable difference). Non-blocking.
- **Scope drift / AC coverage**: both ACs trace to concrete tasks. AC1 ("never another
  conversation's leftover draft by accident") → D1's clear-on-switch, tasks 1.1-1.3, spec
  scenario 1. AC2 (no regression of HEL-695's continuous-sending-indication, and vice versa) →
  D2's ref-based self-created carve-out, task 2.3, spec scenario 3. Confirmed by reading the
  actual `handleSubmit` code that the reset effect (per design) never touches `sending` at all —
  only `message`/`error`/`pendingSend` — which is precisely what keeps HEL-695's spinner
  continuity safe under every code path, not just the self-created one.
- **Missing contract updates**: none applicable — pure frontend-local-state change, no
  API/schema surface touched, and the proposal/design/impact sections agree there is none.
- **Edge case I traced beyond what's written**: a user manually switching conversations
  *during* the async gap of the self-created flow (between `handleSubmit` calling
  `createConversation()` and the `selfCreatedIdRef` being set right before the
  `setSelectedConversationId` dispatch) would hit an *unintended* intermediate reset of
  `message`/`pendingSend` for a send that is still in flight, because the ref isn't set yet at
  that point. I confirmed this doesn't violate either AC: `sending` is never reset by this design
  regardless of path, so the spinner-continuity guarantee AC2 cares about holds regardless; the
  scenario is also a sub-case of the ticket's own explicitly stated Non-Goal ("Handling a user
  manually switching conversations while a send for the previous conversation is still in
  flight... not covered by the AC"). Flagged below as a non-blocking note only.

### Verdict: CONFIRM

The design is sound, concretely specified, consistent across all four artifacts, traces cleanly
to both ACs, and its claims about the existing code (state shape, mount structure, dispatch call
site, `startingNewConversation` interaction) all check out against the real source. No contract
gaps, no scope drift, no blocking ambiguity.

### Non-blocking notes

1. `design.md`'s "Risks / Trade-offs" section names the mid-flight-manual-switch-away race for
   an *ordinary* in-flight send, but doesn't separately call out the narrower variant specific to
   the self-created (`null -> targetId`) flow — where a switch landing in the network-await
   window before `selfCreatedIdRef` is set causes an unintended intermediate clear of
   `message`/`pendingSend` (not `sending`) for that in-flight send. Worth a one-line addition to
   Risks for completeness, but it doesn't violate either AC (see analysis above) and is a
   sub-case of the ticket's own stated Non-Goal, so it doesn't block this gate.
2. `tasks.md` 1.1 doesn't specify `prevConversationIdRef`'s initial value; either reasonable
   choice (`useRef(conversationId)` or `useRef(null)`) is behaviorally inert given `message`/
   `error`/`pendingSend` start empty. Worth pinning down for implementer consistency, not a
   design defect.

### Environmental note (not part of the verdict)

`WORKTREE_PATH/scripts/concertino/` is missing `next-report-number.sh`, `persist-evidence.sh`,
and `emit-event.sh` (confirmed via `ls` and `git ls-files` — these three, along with several
other procedure scripts, are gitignored/untracked in the main checkout and are not copied into a
freshly created worktree by `setup-worktree.sh`, unlike `assert-phase.sh`/`cleanup.sh`/
`start-servers.sh`, which are git-tracked and so are present). I verified these scripts are
self-contained (they resolve all paths from their arguments and from `git rev-parse
--git-common-dir`/`--show-toplevel`, not from their own script location or an implicit cwd), so
I invoked the byte-identical copies from the main checkout
(`/home/matt/Development/helio/scripts/concertino/`) against this worktree's actual change
directory to produce this report's filename, persist it, and emit the verdict — this is not a
guessed fallback filename, it's the same deterministic disk-scan algorithm applied to the correct
target directory. Flagging so the worktree-provisioning gap itself can be tracked as a follow-up.
