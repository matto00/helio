## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS (with one gap surfaced by live verification, see Phase 3)

- [x] All ticket acceptance criteria addressed explicitly — AC1 (composer on both entry points),
      AC2 (real backend endpoint calling `AssistantService.converse` + persisting via
      `AssistantConversationService`), AC3 (existing `MessageTurn`/`ToolCallIndicator`/
      `ProposalHandoff` reused, no new rendering path), AC4 (empty-state create-then-converse), AC5
      (live round-trip) are each traceable to a specific design.md decision (D1–D7) and a specific
      tasks.md item, and I independently confirmed each is genuinely implemented (see Phase 2/3).
- [x] No AC silently reinterpreted — design.md's own two design-gate rounds already closed the two
      real gaps round-1 found (`Failed` outcome signaling, `selectedConversationId` dispatch); I
      re-verified both fixes are actually in the shipped code (see Phase 2).
- [x] All 29 tasks.md items marked done and match what was implemented — spot-checked every backend
      task (1.1–1.3, 2.1–2.2, 3.1–3.4) and frontend task (4.1–4.2, 5.1–5.5) against the real diff;
      no stale/unimplemented checkbox found.
- [x] No scope creep — `git diff --stat` matches proposal.md's Impact section file-for-file (backend
      5 main files + 2 new test files, frontend 8 files + 2 new test files, 1 new schema, 1 new e2e
      spec). No unrelated refactor.
- [x] No regressions to existing behavior — the other 5 `assistant-conversations` routes
      (list/create/get/append/pin) are untouched in the diff except the constructor's new second
      param; `AssistantConversationRoutesSpec`'s `503`-while-`GET`-still-works test and the full
      2832/2832 `sbt test` run (including every pre-existing spec) confirm this.
- [x] API contracts/schemas updated — `schemas/converse-request.schema.json` added,
      `npm run check:schemas` passes (55 checked across 43 protocol files, in sync).
- [x] Planning artifacts reflect the final implemented behavior — design.md D1–D7 match the real
      diff exactly (verified line-by-line against `AssistantService.scala`, `ApiRoutes.scala`,
      `AssistantConversationRoutes.scala`, `MessageComposer.tsx`, `ActiveConversationPanel.tsx`).

Issues: none at the planning-artifact level. The one real gap (below) is a live-behavior defect the
design/tasks artifacts never anticipated, not a spec-vs-implementation mismatch — flagged fully in
Phase 3 since it's an executable, not a planning, problem.

### Phase 2: Code Review — PASS

Ran the gates myself, fresh, in `WORKTREE_PATH` (`EVALUATOR_CLEAN_WORKTREE=false` per
workflow-state.md, so no clean-worktree re-run required):

- `npm run lint` (frontend) — clean, zero warnings.
- `npm run format:check` (frontend) — clean.
- `npm test` (frontend) — **1690/1690 passed**, 170 suites.
- `npm --prefix frontend run build` — succeeded (pre-existing >500kB chunk-size warning only, not
  introduced by this diff).
- `cd backend && sbt test` — **2832/2832 passed**, 182 suites, 0 failed/canceled, "All tests
  passed."
- `npm run check:schemas` — in sync.
- `npm run check:scala-quality` — clean (105 pre-existing file-size soft warnings only — informational
  per CONTRIBUTING.md; `AssistantServiceSpec.scala` grew from 269→331 lines, already over the
  250-line soft budget on `main` before this change, non-blocking).
- `npm run check:openspec` — flags "complete but not archived," expected pre-archive per HEL-664's
  own established precedent (executor called this out explicitly; not a defect).

Traced all 8 items the orchestrator flagged for independent verification, against the real code
(not the executor's claims):

1. **`converse` → `Future[Either[ClaudeError, AssistantTurnResult]]`** — confirmed in
   `AssistantService.scala:50,82-98`. `ClaudeToolOutcome.Failed(error)` → `Left(error)` directly
   (line 97), never a fabricated result. `AssistantServiceSpec.scala` unwraps `Right` mechanically
   in every pre-existing success-path assertion (`awaitRight` helper, lines 33-38) with no
   assertion changed beyond the unwrap; new tests 6.1/6.2/6.2a (`fullHistory` populated for
   `FinalResponse`/`HopBudgetExhausted`, `Left` for `Failed`) all pass.
2. **`POST /:id/converse` error mapping + no persistence on failure** — confirmed in
   `AssistantConversationRoutes.scala:72-113` (`mapClaudeError`: `ApiError`/`TransportFailure` →
   `BadGateway`, `GuardrailExceeded` → `UnprocessableEntity`; `converseFlow`'s `Left` branch never
   calls `appendTurn`). Verified with a real test, not just a code read:
   `AssistantConversationRoutesSpec`'s "return the mapped error status and persist nothing" test
   (tasks 6.3a) asserts `BadGateway` AND a subsequent `GET` shows an empty transcript — passed.
3. **`setSelectedConversationId(newId)` dispatched between `createConversation()` and `converse()`**
   — confirmed in `MessageComposer.tsx:44-50`. Live-verified myself (Phase 3): sending from the
   empty state correctly transitioned to the new conversation's success-state view, not stuck on
   `EmptyState`.
4. **`WorkspaceSearchService`/`assistantServiceOpt` wiring matches design.md D2 exactly** —
   confirmed in `ApiRoutes.scala:335-353`; gated on `ClaudeConfig.fromEnv()` AND `metricServiceOpt`,
   fresh `ClaudeClient` per service, matches the pseudocode verbatim including the two `log.warn`
   branches.
5. **Other 5 routes unaffected** — `AssistantConversationRoutes.scala`'s list/create/get/patch/append
   routes are untouched in the diff (only the constructor gained a second param); the `dbContext`
   -only `.fold(reject)` gate in `ApiRoutes.scala:519` is unchanged; full `sbt test` run confirms no
   regression.

Issues: none blocking at the code-quality/correctness-of-wiring level. See Phase 3 for the one real
defect this review surfaced, which is a cross-cutting interaction bug (pre-existing
`AssistantService.seedHistory` behavior + this ticket's new persist/render path), not a violation
of any CONTRIBUTING.md/DESIGN.md mechanical rule.

### Phase 3: UI Review — FAIL

Dev servers were already healthy (left running by the executor); confirmed via
`scripts/concertino/start-servers.sh` (reused) and `scripts/concertino/assert-phase.sh servers` →
`PASS servers`.

**Live-verified, working correctly:**

- **AC5 live round-trip (item 6), re-run myself, not trusting the executor's transcript**: on the
  existing "Test skeptic verification message" conversation (`/chat`), typed "Evaluator live check
  HEL-665 cycle 1: reply with the single word PONG." and clicked Send. A real Claude reply ("PONG")
  rendered within ~30s via the same `MessageTurn` bubble style as the pre-existing turns, message
  count went 2→4, input cleared, Send button correctly disabled again. Zero console errors
  throughout. Reloading `/chat` (a fresh `GET`) still showed all 4 messages — genuine backend
  persistence, not client-only state.
- **Composer available from both entry points (item 7)**: confirmed identical composer
  (textbox + Send) renders inside the quick-launcher overlay (`Meta+K`) — same shared
  `ActiveConversationPanel`, not a second implementation.
- **No layout breakage** at 1440 / 1100 / 768 / 390px (mobile) — structurally sound at every
  breakpoint tested.
- Accessible names present: textbox has `aria-label="Message"`, button has accessible name "Send".

**Defect found (live-verified, reproducible, blocking):**

- **A brand-new conversation's first "You" turn is polluted with the entire internal
  `AssistantSystemPrompt` text, not just the user's typed message.** Registered a genuinely fresh
  user (`hel665-eval-cycle1@helio.dev`, zero conversations — confirmed via a real `EmptyState` on
  `/chat`), typed "Evaluator empty-state check HEL-665: reply with the single word PONG2." into the
  empty-state composer, and clicked Send (AC4's own scenario). The create-then-converse flow worked
  mechanically — a new conversation was created, became the active selection, and Claude's "PONG2"
  reply arrived and rendered. **But the persisted and rendered "You" turn is not the message I
  typed** — it is `AssistantSystemPrompt.text` (~1500 words of internal tool documentation: "You
  are Helio's dashboard/pipeline assistant... Tools available to you: - find(query,
  resourceTypes?)... Hard rules: ...") with my actual message silently appended at the very end,
  rendered verbatim inside the same `message-turn__text` bubble. Confirmed at 1440/768/390px — the
  system-prompt wall of text visually dominates the turn; a screen reader or a user scrolling would
  see internal tool-contract text attributed to themselves, with the real content buried at the
  bottom. Reproduced identically in the quick-launcher overlay (same persisted data, same shared
  component).
  - **Root cause**: `AssistantService.seedHistory` (`backend/src/main/scala/com/helio/services/
    AssistantService.scala:74-77`) folds `AssistantSystemPrompt.text + "\n\n" + message` into the
    *same* `ClaudeToolMessage` used as the conversation's first turn whenever the caller-supplied
    `history` is empty — necessary because `ClaudeToolRequest` has no separate `system` field. This
    is pre-existing HEL-662 behavior, safe at the time because `converse`'s result was never
    persisted or rendered to a real user (every prior ticket in this epic explicitly deferred wiring
    a live route). **This ticket is the first to thread that literal seeded turn through
    `AssistantTurnResult.fullHistory` → `AssistantConversationRoutes.converseFlow`'s
    `result.fullHistory.drop(existing.transcript.length)` (`AssistantConversationRoutes.scala:96-107`,
    for a brand-new conversation this is `drop(0)`, i.e. the whole seeded turn) →
    `service.appendTurn` (persisted verbatim) → `MessageTurn.tsx` (rendered verbatim, no
    stripping/truncation).** Neither design.md nor tasks.md anticipated this interaction between
    `seedHistory`'s pre-existing system-prompt-folding and this ticket's new
    persist-and-render-`fullHistory` behavior — it's a genuine, previously-unexercised code path
    this ticket's own new live wiring is what actually exposes.
  - This directly undermines AC4's own stated scenario ("...the conversation becomes the active
    selection, showing the sent message and its response" — not the sent message buried under
    ~1500 words of internal tool-contract text) and the general product expectation that a
    composer echoes back what the user actually typed.
  - Does **not** occur on a second-or-later message in the same conversation (confirmed: my first
    live test, against an already-populated conversation, rendered cleanly) — `seedHistory` only
    folds the system prompt when `history.isEmpty`, i.e. exactly the empty-state/first-message path
    that AC4 exists to cover.

### Overall: FAIL

### Change Requests

1. **Stop the internal `AssistantSystemPrompt` text from being persisted/rendered as part of a
   conversation's first user-visible turn.** The system-prompt augmentation must stay confined to
   what `AssistantService.converse` sends *outbound* to Claude (`ClaudeToolRequest.history`); it must
   never appear in the value returned as `AssistantTurnResult.fullHistory`'s first user-turn text,
   since that value is now (as of this ticket) both persisted via `AssistantConversationService
   .appendTurn` and rendered verbatim via `MessageTurn`. Concretely, this needs a design-level fix
   in `AssistantService.scala` — e.g., have `converse`/`toTurnResult` reconstruct or strip the first
   turn's persisted/returned text back down to the caller's original `message` parameter (rather
   than the system-prompt-augmented text `seedHistory` builds for the outbound request), while
   leaving what's actually sent to `sendWithTools` unchanged. Live-verified repro: register a fresh
   user, go to `/chat` (real `EmptyState`), type any message into the composer, click Send — the
   persisted+rendered "You" turn is `AssistantSystemPrompt.text` + the typed message concatenated,
   not the typed message alone. Add a regression test (backend, e.g. extending
   `AssistantServiceSpec`'s `fullHistory` coverage) asserting that for an empty-`history` call,
   `AssistantTurnResult.fullHistory`'s first (user) turn's text equals exactly the caller-supplied
   `message` — never the system-prompt-augmented text — plus an `AssistantConversationRoutesSpec`
   or `ActiveConversationPanel`-level assertion covering the create-then-converse (empty-history)
   path specifically, since the existing test suite's `converse` tests all happen to exercise a
   non-empty `history` (task 6.3/6.3a's fixture creates the conversation via `conversationService
   .create` with no prior turns, but never asserts on the *content* of the persisted first turn —
   only that it "renders" and "has size 2" — which is why this shipped without any test catching
   it).

### Non-blocking Suggestions

- `backend/src/test/scala/com/helio/services/AssistantServiceSpec.scala` is now 331 lines, over the
  250-line soft budget (`check:scala-quality`, informational only — already over-budget on `main`
  before this ticket at 269 lines). Consider a split next time this file is touched; not required
  for this ticket.
