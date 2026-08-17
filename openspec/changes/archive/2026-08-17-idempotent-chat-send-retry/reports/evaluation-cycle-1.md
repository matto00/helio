## Evaluation Report — Cycle 1 (evaluation-cycle-1.md)

**Ticket:** HEL-698 — Chat send can succeed server-side while the client reports failure
**Commit reviewed:** 874c81041a901a4b4dee7d288b0f79f7aab3d36c (single commit on top of main's 996f6501)

### Phase 1: Spec Review — PASS

- AC1 ("Retrying a message after a 'failed' send that actually landed server-side does not
  produce a duplicate/near-duplicate user turn") — addressed via the server idempotency key
  (`last_idempotency_key`, V87 migration), the route-entry replay check
  (`AssistantConversationRoutes.converseFlow`), and the append-time replay check
  (`AssistantConversationService.appendTurn`). Confirmed both checks exist per design.md D3 and
  are each independently tested (`AssistantConversationRoutesSpec`, `AssistantConversationServiceSpec`).
- AC2 ("After an error response, the client's displayed state accurately reflects whether the
  message landed") — addressed via `assistantConversationsSlice.converse`'s rejection-path
  reconciliation (re-fetch `GET /:id`, compare `lastIdempotencyKey`). Verified live (see Phase 3)
  and via `assistantConversationsSlice.test.ts` / `MessageComposer.test.tsx`.
- No AC silently reinterpreted — both mechanisms map 1:1 to design.md D1's stated split
  ("server idempotency key → AC1", "client reconciliation → AC2").
- All 33 tasks.md items marked `[x]`; spot-checked each backend/frontend item against the diff —
  implementation matches every task description (migration, repository threading, service
  short-circuit, route replay check + validation, schema updates, slice/composer wiring, and all
  five listed test files).
- No scope creep — `files-modified.md` lists exactly the files touched in the diff; nothing extra
  (e.g., no unrelated refactors, no drive-by changes to unrelated conversation routes).
- No regressions to existing behavior — the keyless path is exercised explicitly by both new tests
  and unchanged pre-existing tests (e.g., `ActiveConversationPanel.test.tsx`'s two updated
  assertions only widen the expected call signature to `expect.any(String)`, they don't change
  behavior expectations). Full backend (3101 tests) and frontend (1863 tests) suites pass with zero
  failures.
- API contracts updated: `converse-request.schema.json` (+`idempotencyKey`, maxLength 128) and
  `assistant-conversation.schema.json` (+`lastIdempotencyKey`) both updated in the same change as
  the Scala protocol (`jsonFormat1`→`jsonFormat2`, `jsonFormat7`→`jsonFormat8`); `check:schemas`
  passes (61 protocols checked, in sync).
- Planning artifacts (design.md D1–D6, Planner Notes) reflect the final implementation exactly —
  cross-checked D2's "leave-untouched on `None`" semantics against `touchUpdatedAt`'s two-branch
  `updateAction`, D3's double-check placement against both `converseFlow` and `appendTurn`, D5's
  wire contract against the actual `ConverseRequest`/`AssistantConversationResponse` case classes,
  and D6's composer key-lifecycle against `MessageComposer.tsx`'s `pendingSend` logic. All match.
  Per the task brief, the disclosed-and-accepted multi-sender race and the keyless-leaves-untouched
  semantics (both skeptic-approved in design.md's Planner Notes) are not flagged as defects here.

### Phase 2: Code Review — PASS

**Gates (fresh run, `WORKTREE_PATH`, no `CLEAN_WORKTREE`):**

| Gate | Result |
|---|---|
| `cd backend && sbt test` | PASS — 3101 tests, 0 failed, 194 suites |
| `npm run lint` (frontend) | PASS — zero warnings |
| `npm run format:check` (frontend) | PASS |
| `npm test` (frontend, full suite) | PASS — 1863 tests, 180 suites |
| `npm --prefix frontend run build` | PASS — production build succeeds (pre-existing >500kB chunk-size warning, unrelated to this diff) |
| `npm run check:schemas` | PASS — 61 protocols in sync |
| `npm run check:scala-quality` | PASS (114 pre-existing soft-budget warnings, none newly introduced — see below) |
| `npm run check:openspec` | Expected-fail — "complete (20/20) but not archived", the one pre-archive deviation the task brief calls out; not treated as a gate failure |

**Canonical standards:**

- **CONTRIBUTING.md [mechanical] — Imports & Qualifiers**: no inline FQNs introduced anywhere in
  the diff; the one new import (`AssistantConversationRoutes.scala:8`,
  `com.helio.api.{ErrorResponse, JsonProtocols, RequestValidation}`) is a proper top-of-file import.
  `check:scala-quality` confirms mechanically.
- **CONTRIBUTING.md [mechanical] — file-size soft budgets**: all six modified/new main-source
  files are within the 250-line budget (`RequestValidation.scala` 169, `AssistantConversationProtocol.scala`
  86, `AssistantConversationRoutes.scala` 236, `AssistantConversationRepository.scala` 248,
  `AssistantConversationService.scala` 214, migration 9). The three modified test files exceed the
  informational-only test budget (`AssistantConversationRoutesSpec.scala` 475,
  `AssistantConversationRepositorySpec.scala` 311, `AssistantConversationServiceSpec.scala` 268) —
  per CONTRIBUTING.md line 123 this is informational-only, and none of these are newly-created
  files crossing the budget for the first time because of this change alone (this codebase's test
  suites routinely run well past 250 lines, per the wider `check:scala-quality` output).
- **CONTRIBUTING.md — ACL triad / RLS**: no new repository read method added; `touchUpdatedAt`'s
  existing owner-scoped `filtered` query is reused for both the `Some`/`None` update branches — no
  new ACL surface introduced.
- **DESIGN.md**: N/A for `[mechanical]` token/spacing rules — the frontend diff
  (`MessageComposer.tsx`, slice, service, types) is logic-only; no `.css` file was touched and no
  new DOM/visual elements were added (`git diff --name-only` confirms no `MessageComposer.css`
  change). Existing `InlineError`/spinner patterns are reused unchanged.
- **DRY**: `touchUpdatedAt`'s `Some`/`None` branching reuses the existing `filtered` query builder
  rather than duplicating the filter predicate; `converseFlow`'s replay check reuses `detailOf`
  rather than hand-building a response.
- **Readable**: naming is precise and self-documenting (`lastIdempotencyKey`, `pendingSend`,
  `validateIdempotencyKey`); `MaxIdempotencyKeyLength = 128` is a named constant, not a magic number.
- **Modular**: the key-length validation lives in `RequestValidation` (mirrors the file's existing
  `normalizeText` pattern) rather than inline in the route; the replay short-circuit is a clean
  pattern-match branch, not a nested conditional.
- **Type safety**: `Option[String]` used throughout (backend and frontend) rather than
  sentinel values (`""`/`null`); no `any`/untyped escape hatches in the TypeScript diff.
- **Security**: `idempotencyKey` is length-bounded (400 on >128 chars) and trimmed before use, both
  server-side (`RequestValidation.validateIdempotencyKey`) and consistent with the schema's
  `maxLength: 128`; it is used only as an opaque equality-compared string (no interpolation into
  SQL — the Slick `.update` calls are parameterized), so no injection surface.
- **Error handling**: reconciliation failure (a failed `getConversation` fetch) falls through to
  the original rejection rather than silently swallowing or masking the error — exercised directly
  by `assistantConversationsSlice.test.ts`'s "a failed reconciliation fetch itself still rejects"
  case, and confirmed live (see Phase 3, backend-down test).
- **Tests meaningful**: each new backend test asserts on an observable side effect that would fail
  under a real regression (transcript size, `transport.receivedRequests.size`, persisted column
  value) rather than just non-throwing; frontend tests assert on dispatched action types/payloads
  and rendered DOM state, not implementation internals.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: the design explicitly rejects a multi-key table / per-conversation lock
  as unnecessary for a single-composer-owner chat (Planner Notes) — the implementation matches that
  restraint (single nullable column, no new infrastructure).
- **Behavior-preserving where expected**: the `/messages` append route's keyless call site is
  unchanged in behavior (default `None` param, verified by `AssistantConversationServiceSpec`'s
  "keyless append leaves a previously-set key in place" test) — no drive-by behavior change.

No violations found.

### Phase 3: UI Review — PASS

Dev servers started via `scripts/concertino/start-servers.sh` at 6130/9037 for HEL-698;
`assert-phase.sh servers` returned `PASS servers`. (Both scripts logged a non-fatal
`emit-event.sh: No such file or directory` — that script is absent in this worktree; it did not
block server startup or health, so not treated as a gate issue.)

- **Happy path end-to-end**: sent a live message in an existing conversation via the real UI.
  Transcript grew from 4→6 messages, input cleared, no error. Independently confirmed via
  `fetch('/api/assistant-conversations/:id')` that `lastIdempotencyKey` was populated with the
  client-generated key on the persisted row — proves the migration, repository write, service
  short-circuit-skip path, and route wiring are all live and correct end-to-end, not just
  unit-test-verified.
- **Unhappy path**: stopped the worktree's own backend process (port 9037, PID isolated to this
  worktree) mid-composer, submitted a message. Result: error banner "Request failed with status
  code 502" shown, typed input preserved verbatim in the textbox — exactly the AC2 contract for a
  genuinely-failed send (both the `converse` call and the reconciliation `GET` failed, since the
  backend was fully down, so correctly falls through to the original rejection). Restarted the
  backend via the same canonical script, retried the send (fresh, since the backend restart meant
  nothing had landed) — succeeded normally, input cleared, transcript updated to 8 messages.
- **No console errors** during any tested flow beyond the two expected 502s from the deliberate
  backend-down test (both logged, neither an unhandled exception or blank screen — the UI degraded
  to the documented error-banner state, not a crash).
- **Loading/empty/error states**: the "Sending…" spinner (pre-existing pattern, unaffected by this
  diff) is present during the request; `InlineError` (shared component) surfaces the failure text;
  no blank-screen states observed.
- **Accessible names / keyboard**: `Textarea` carries `aria-label="Message"`; Send button has a
  discoverable accessible name ("Send"); both located and driven via `getByLabelText`/`getByRole`
  in the new tests, confirming accessible-name presence mechanically.
- **Breakpoints**: checked 1440, 1100, and 768 via screenshot — sidebar/nav collapses to the mobile
  bottom-nav pattern at 768 as expected, composer input remains fully usable at all three widths,
  no layout breakage or overlap observed. (This diff makes no CSS changes — `MessageComposer.css`
  is untouched in the diff — so breakpoint risk from this specific change is inherently low; spot
  checks confirm no incidental breakage.)

### Overall: PASS

No change requests. This is cycle 1 of 3 (not the final cycle), so no Critical Path section is
required regardless.

### Non-blocking Suggestions

- `scripts/concertino/emit-event.sh` is missing from this worktree, causing both
  `start-servers.sh` and `assert-phase.sh` to print a non-fatal `No such file or directory` line
  before their `READY`/`PASS` output. Cosmetic/environmental, not a code defect in this change —
  flagging in case it's worth a fleet-wide worktree-setup fix.
- `AssistantConversationRoutesSpec.scala` is now 475 lines (was ~407 before this diff), already
  well past the 250-line informational soft budget. Not a blocker (informational-only per
  CONTRIBUTING.md), but a natural split point (e.g., extracting the idempotency-key `describe`
  block into its own spec file) if this file keeps growing.
