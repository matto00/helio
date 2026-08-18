## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All ticket ACs addressed explicitly:
  - AC1 ("switching conversations presents a composer state that is deliberate ... never another
    conversation's leftover draft by accident") → implemented via `useEffect([conversationId])`
    clearing `message`/`error`/`pendingSend` on a genuine id change. Verified live in the browser
    (typed a draft in conversation A, switched to conversation B, textarea value confirmed `""`).
  - AC2 ("does not regress HEL-695's continuous-sending-indication AC, and vice versa") →
    implemented via `selfCreatedIdRef` one-shot carve-out. Verified live in the browser against
    the real backend (not mocked): drove the composer through the null-conversation self-send
    flow with a 15ms-interval poll spanning the whole request lifetime — `sending` indicator and
    draft text stayed continuously present (`disabled: true`, `sendingVisible: true`, draft value
    unchanged) from t=15ms through t=1187ms, then cleared cleanly at t=1203ms on success. No dead
    moment, no flicker, matches HEL-695's fix exactly.
- No AC silently reinterpreted — `design.md` D1 explicitly weighs "clear on switch" vs.
  "per-conversation persistence" and picks the ticket's own first-listed, simplest acceptable
  outcome; not a reinterpretation.
- All `tasks.md` items (1.1–1.4, 2.1–2.4) marked done and match the diff: two refs
  (`prevConversationIdRef`, `selfCreatedIdRef`), the ref set immediately before
  `setSelectedConversationId` in the null-conversation branch, the reset effect with the exact
  described skip/consume logic, the doc-comment update, and three new tests matching 2.1–2.3
  exactly (verified by reading `MessageComposer.tsx` and `MessageComposer.test.tsx` in full, not
  just the diff).
- No scope creep: `git diff --name-only main...HEAD` on source touches only `MessageComposer.tsx`
  + `MessageComposer.test.tsx`. Confirmed `ActiveConversationPanel.tsx` and
  `assistantConversationsSlice.ts` have zero diff, matching the proposal's stated "no change to
  ActiveConversationPanel's mount structure ... or the server-side idempotency-key comparison."
- No regressions to existing behavior: full Jest suite passes (2255/2255, see Phase 2); existing
  `MessageComposer.test.tsx` tests (idempotency-key reuse/mint, reconciliation-fetch match/
  mismatch) all still pass unmodified.
- No API/schema changes needed or made — correctly a frontend-local-state-only change (`git diff`
  confirms zero backend/schema files touched).
- Planning artifacts reflect the final implementation: `proposal.md`/`design.md`/`tasks.md`/the
  `chat-message-composer` spec delta all describe exactly the ref-plus-effect shape that shipped;
  cross-checked scenario text in `specs/chat-message-composer/spec.md` against the three new test
  names and confirmed a 1:1 mapping.

### Phase 2: Code Review — PASS

Issues: none.

Gates re-run fresh by me in `WORKTREE_PATH` (not trusted from the executor's report; `default`
speed, `EVALUATOR_CLEAN_WORKTREE=false` per `workflow-state.md`, so no clean-worktree re-run
required):

- `npm run lint` → clean, zero warnings.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` (full suite) → `Test Suites: 212 passed, 212 total` / `Tests: 2255 passed, 2255
  total`.
- `npm --prefix frontend run build` → succeeds (`vite build` completes; the one warning is the
  pre-existing >500kB chunk-size advisory, unrelated to this change — no new files/imports were
  added by this diff that would affect bundling).

Standards review (`CONTRIBUTING.md`; `DESIGN.md` not triggered — zero markup/CSS in the diff, pure
local-state logic):

- **File-size budget**: `MessageComposer.tsx` is 181 lines (was ~140 before), well under the
  ~250-line soft budget.
- **Imports & Qualifiers**: all new imports (`useEffect`, `useRef`) added at the top-of-file
  import statement; no inline FQNs introduced.
- **DRY**: no duplication — the two-ref/one-effect shape is the minimal mechanism for the
  distinction the design needs (D2 explicitly rejected a broader `sending`-guard alternative as
  imprecise, and a `pendingSend`-carries-conversation-id alternative as more surface than needed).
- **Readable**: `prevConversationIdRef`/`selfCreatedIdRef` names are self-explanatory; every
  non-obvious line is commented with its design.md decision reference (D1/D2); no magic values.
- **Modular**: reset logic is fully contained in one effect; `handleSubmit`'s one-line addition
  (`selfCreatedIdRef.current = targetId`) is the minimal touch point into existing logic.
- **Type safety**: no `any`/untyped escape hatches; `useRef<string | null>(null)` is correctly
  typed against `conversationId: string | null`.
- **Security**: N/A — no new input/boundary surface.
- **Error handling**: unaffected — existing try/catch/finally in `handleSubmit` untouched; the new
  effect has no failure mode of its own (pure state clears).
- **Tests meaningful**: the three new tests exercise real regression scenarios, not the happy path
  only — (1) plain draft clear on switch, (2) failed-send draft+key clear on switch with a
  subsequent send proving a *fresh* key is minted (would catch a bug where `pendingSend` survives
  the switch), (3) the self-created transition using a manually-resolved `Promise` to freeze the
  mid-flight window and assert `sending`/draft state is untouched (would directly catch a
  regression of HEL-695). All 8 tests in the file pass (`npm test -- --testPathPatterns=
  MessageComposer`).
- **No dead code**: no leftover `TODO`/`FIXME`/unused imports (grepped, none found).
- **No over-engineering**: two refs + one effect matches design.md's explicit rejection of a
  bigger persistence subsystem (D1) — the smallest change that satisfies both ACs.
- **Behavior-preserving where expected**: this is a deliberate bug fix, not a refactor: the reset
  behavior is new by design, and the diff makes no other behavior changes (confirmed via full
  diff read — `handleSubmit`'s success/failure paths, `pendingSend` key logic, and render/JSX are
  byte-identical except the single `selfCreatedIdRef.current = targetId` insertion).

### Phase 3: UI Review — PASS

Triggered by `frontend/**` changes. Dev/backend servers started via
`scripts/concertino/start-servers.sh` + `assert-phase.sh servers` (both reported `PASS`/`READY`;
`emit-event.sh` is missing from this worktree's `scripts/concertino/` — a pre-existing,
already-diagnosed provisioning gap, matching the round-1 design-gate skeptic's note that
`next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` are gitignored and not copied by
`setup-worktree.sh`; non-blocking, cosmetic stderr only, servers still came up healthy).

Checks:

- **Happy path end-to-end**: verified live against the real backend (no mocks) on `/chat`.
  1. Typed a draft in one conversation, clicked a different conversation in the sidebar — draft
     cleared (`textarea.value === ""` confirmed via DOM read).
  2. Started a brand-new chat (`+ New chat` → null-conversation state), typed a message, sent it —
     the composer created a conversation (`POST /api/assistant-conversations` → 201, followed by
     `POST .../converse` → 200), `conversationId` flipped `null → newId` mid-flight, and the
     sending indicator + draft text persisted unbroken through the entire request (sampled every
     15ms) before clearing on success. Final transcript rendered the real assistant reply
     correctly.
- **Unhappy paths**: pre-existing failure/reconciliation-fetch paths (network error, retry,
  reconciliation match/mismatch) are unaffected by this diff and still pass in the automated suite
  (tests 1–5, unmodified); the new "switch away after a failure" case (test 2.2) is exercised and
  passes, confirming a failed send's preserved draft+key is discarded, not silently kept, on
  switch. No blank screens or unhandled exceptions observed in any manual flow.
- **Loading/empty/error states**: sending spinner (`role="status"`, "Sending…") appears/disappears
  correctly; empty "New conversation" state renders via the existing shared empty-state pattern
  (unchanged by this diff); `InlineError` renders/clears as expected.
- **No console errors**: `browser_console_messages` (errors + warnings, full session) returned
  zero entries across every manual flow tested.
- **Entry points**: `MessageComposer` is the same instance shared by both `/chat` and the
  quick-launcher overlay via `ActiveConversationPanel` (per the component's own doc comment,
  unmodified by this diff) — the fix lives entirely inside the shared component, so no
  per-entry-point retest was structurally necessary; verified on `/chat` directly.
- **Accessible names / keyboard support**: unaffected — `aria-label="Message"` on the textarea and
  the "Send" button's accessible name are untouched by this diff (verified via snapshot: both
  present and correctly labeled throughout).
- **Breakpoints**: checked 1440 / 1100 / 768 / 375 (narrow/mobile) via screenshots — no layout
  breakage at any width. Expected, since the diff contains zero markup/CSS changes (pure local
  state logic); confirmed rather than assumed.

### Overall: PASS

### Non-blocking Suggestions

- `design.md`'s own "Risks / Trade-offs" section (and the round-1 skeptic's non-blocking note)
  flags a narrower race: a user manually switching away during the network-await window of the
  self-created flow, before `selfCreatedIdRef` is set, would cause an unintended intermediate
  clear of `message`/`pendingSend` for that in-flight send. This is explicitly a sub-case of the
  ticket's own stated Non-Goal and doesn't violate either AC (`sending` itself is never touched by
  the reset effect on any path) — not a blocker, already tracked as a known follow-up candidate in
  `design.md`.
