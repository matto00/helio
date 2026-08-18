## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold, not from executor/evaluator narrative):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/chat-message-composer/spec.md`
  fresh from disk.
- `git diff main...HEAD -- frontend/src/features/assistant/ui/MessageComposer.tsx` and
  `MessageComposer.test.tsx` — read the full diff and the full resulting file (not just the hunks).
- `git diff main...HEAD --stat -- frontend/` confirms the diff is scoped to exactly these two
  files (125 insertions, 0 deletions besides the 2-line import change) — no CSS/markup touched, no
  `ActiveConversationPanel.tsx` change, matching the proposal's stated impact.
- Read `ActiveConversationPanel.tsx` in full: confirmed `<MessageComposer conversationId={effectiveId} />`
  carries no `key` prop (line 251) — the "never remounted across an ordinary switch" premise the
  design leans on is real, not asserted.

**AC1 ("switching conversations presents a composer state that is deliberate... never another
conversation's leftover draft by accident") — traced to code + live behavior:**
- Code: `useEffect([conversationId])` at `MessageComposer.tsx:99-110` clears `message`/`error`/
  `pendingSend` on a genuine `conversationId` change unless it matches `selfCreatedIdRef.current`.
- Live (Playwright, real backend, no mocks, `/chat` at `localhost:6143`): typed
  "Skeptic draft check DRAFT-A leftover text" into an existing conversation's composer, clicked a
  different conversation in the sidebar, read `document.querySelector('.message-composer__input').value`
  directly from the DOM — result `""`. Draft cleared for real, not simulated.

**AC2 ("does not regress HEL-695's continuous-sending-indication AC, and vice versa") — traced to
code + live behavior with instrumented polling, not just eyeballing:**
- Code: `selfCreatedIdRef.current = targetId` is set immediately before
  `dispatch(setSelectedConversationId(targetId))` (`MessageComposer.tsx:132-136`); the reset effect
  checks this ref first and skips the clear + consumes the ref when it matches.
- Live: drove the composer through the real null-conversation self-send flow (clicked "+ New chat",
  typed "Skeptic self-create transition check", clicked Send) against the real backend/Claude
  round-trip. Before clicking Send I injected a 15ms-interval poller into the page recording
  `{disabled, value, sendingVisible}` on every tick. Collected 1722 samples over ~25.8s. Result:
  exactly 2 transitions of `sendingVisible` (false→true at t=2175ms, true→false at t=5876ms) — a
  single clean send window, zero flicker/dead-moment. `value` was never empty while `sendingVisible`
  was true (0 of 1722 samples) — the draft was never wiped mid-flight, including across the real
  `null → newId` transition (confirmed via the resulting sidebar: a new "New conversation" entry
  appeared, selected/active, with the sent message and a real assistant reply in its transcript).
  `browser_console_messages` (all levels, full session) — 0 errors, 0 warnings across both flows.

**Regression tests are meaningful, not tautological (systematic-debugging law):** I temporarily
neutered the reset effect's body in the actual worktree file (replaced it with a no-op, same
`[conversationId]` dependency) and reran `MessageComposer.test.tsx`. The two new reset-on-switch
tests failed exactly as expected (`Expected: ""`, `Received: "Draft for A"` /
`Received: "Hello"`); the self-created-transition test and all pre-existing tests still passed
(as expected — neutering only removes the *reset*, not the preservation, which was never touched).
This proves the new tests actually exercise the fixed code path, not a tautology. Restored the
file from a pre-edit backup immediately after (`git diff --stat` on the file now shows 0 changes
vs. HEAD; `git status --short` shows only the pre-existing evaluator artifacts, nothing from me).

**Gates re-run fresh by me (not trusted from evaluator's paste):**
- `npx jest --config jest.config.cjs --testPathPatterns=MessageComposer` → 8/8 pass.
- `npx jest --config jest.config.cjs --testPathPatterns=ActiveConversationPanel` → 21/21 pass
  (includes the real integration-level "creates a conversation and sends to it when none is
  currently selected" test, which exercises the self-created transition through the *actual*
  `ActiveConversationPanel` + real Redux store, not just a manually-driven `rerender` on a
  standalone `MessageComposer` — confirms the fix works in the real component tree, not only in
  isolation).
- `npx jest --config jest.config.cjs` (full suite) → 212 suites / 2255 tests, all pass.
- `npx eslint MessageComposer.tsx MessageComposer.test.tsx` → clean, no output.
- `npx prettier --check` on both files → "All matched files use Prettier code style!"
- `npm run build` → succeeds; only the pre-existing >500kB chunk-size advisory (unrelated to this
  diff — 0 new imports).

**Design-doc soundness (re-checked, not just trusting the round-1 design-gate CONFIRM):**
- D1/D2/D3 in `design.md` are internally consistent with each other and with the diff: two refs
  (`prevConversationIdRef`, `selfCreatedIdRef`), the ref set at the single self-send call site, the
  effect's skip/consume logic exactly as described. No placeholders, no deferred decisions.
- `specs/chat-message-composer/spec.md` uses `## ADDED Requirements` — confirmed correct per
  openspec convention: the archived `openspec/specs/chat-message-composer/spec.md` has no existing
  requirement about switch-reset behavior (grepped `### Requirement:` headers — 3 unrelated ones),
  so this is genuinely new, not a modification misfiled as an addition.
- Scenario text in the spec delta maps 1:1 to the three new test names — cross-checked directly.

**No UI/visual judgment needed:** zero CSS/markup in the diff (confirmed by `--stat` above) — this
is a pure local-state-logic fix to an already-shipped, already-design-reviewed component. DESIGN.md
token/spacing/parity review is not triggered by this change; correctly scoped by the evaluator and
independently confirmed by me via the diff stat, not just taking their word for it.

### Verdict: CONFIRM

Both acceptance criteria are traced to real code, pass in automated tests I personally reproduced,
and were independently verified live against the running app with instrumented polling precise
enough to rule out the exact failure mode (a dead moment / flicker) the non-regression AC cares
about. The regression tests were probe-confirmed to actually catch the bug they claim to catch.
No placeholders, no scope drift, no missing contract updates, no design/implementation
contradictions. Ships.

### Non-blocking notes

- `design.md`'s own Risks/Trade-offs section already tracks the one real remaining edge case (a
  user manually switching away *during* the network-await window of the self-created flow, before
  `selfCreatedIdRef` is set) as a known, explicitly out-of-AC follow-up candidate — agree with that
  scoping, not a blocker.
- This worktree's `scripts/concertino/` is missing `next-report-number.sh`/`persist-evidence.sh`/
  `emit-event.sh` (gitignored, not copied by `setup-worktree.sh` for this worktree) — same
  pre-existing provisioning gap the evaluator already flagged. I invoked all three via their
  absolute path in the main checkout (`/home/matt/Development/helio/scripts/concertino/`), which
  works fine since they resolve paths via `git -C <path>` rather than assuming cwd. Environmental,
  not a code defect — not scored against this change.
