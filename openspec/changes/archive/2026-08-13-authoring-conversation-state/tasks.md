## 1. Backend: persistence

- [x] 1.1 Verify the actual current Flyway head (`ls backend/.../db/migration | sort -V | tail -1`)
      before naming the migration — do not trust the ticket's stale note.
- [x] 1.2 Add `V<next>__authoring_conversations.sql`: `id TEXT PK`,
      `owner_id UUID NOT NULL REFERENCES users(id)`, `api_history JSONB NOT NULL`,
      `display_turns JSONB NOT NULL`, `latest_proposal JSONB`,
      `total_tokens_used INTEGER NOT NULL DEFAULT 0`, `created_at`/`updated_at TIMESTAMPTZ`, index on
      `owner_id`. RLS mirrors `V75__metrics.sql` exactly (design.md D3).
- [x] 1.3 Add `AuthoringConversationRepository` (Slick, `withUserContext`, mirrors
      `MetricRepository`): `create`, `findById` (RLS-scoped — missing/not-owned both resolve to
      "not found"), `appendTurn` (updates `api_history`/`display_turns`/`latest_proposal`/
      `total_tokens_used` together), `findDisplayById` (the subset `GET` needs — D7).

## 2. Backend: protocol

- [x] 2.1 Add `conversationId: Option[String]` to `DashboardAuthoringRequest`; add `conversationId:
      String` to `DashboardAuthoringResponse` and `AuthoringStreamEvent.Result`.
- [x] 2.2 Add `AuthoringDisplayTurn(role, text)` + `AuthoringConversationView(conversationId,
      displayTurns, latestProposal)` for the new `GET` response (D7).
- [x] 2.3 New/updated JSON schemas for the additive `POST` fields and the new `GET` response.
- [x] 2.4 Add `AuthoringHistoryBudget` (`trim(apiHistory, maxTokens): Vector[ClaudeMessage]`, dropping
      oldest turn-pairs via `ClaudeTokenEstimator.estimate`, `DefaultMaxHistoryTokens = 20000`) and
      `DefaultMaxConversationTokens = 200000` (D4/D5).

## 3. Backend: DashboardAuthoringService

- [x] 3.1 On a request with `conversationId`: load the conversation (RLS-scoped); missing/not-owned →
      `NotFound`. Exhausted budget (`total_tokens_used >= DefaultMaxConversationTokens`) →
      `UnprocessableEntity` before any Claude call.
- [x] 3.2 Build the Claude message vector from `AuthoringHistoryBudget.trim(persisted api_history,
      DefaultMaxHistoryTokens)` + the new user message (reusing `goal`, plain text only for turn 2+ —
      no re-embedded grounding, D3) instead of always starting fresh; existing repair machinery
      unchanged otherwise.
- [x] 3.3 On no `conversationId`: behave exactly as today, but also create a new
      `authoring_conversations` row for turn 1 (persistence is a transparent side effect, D1).
- [x] 3.4 On success, persist updated `api_history`/`display_turns` (append the user's typed text +
      a deterministic `"Proposed \"<name>\" (<n> panel(s))"` summary, never raw JSON, D6) +
      `latest_proposal` + incremented `total_tokens_used` (real `usage`, never the estimate); include
      `conversationId` in the response/event. Persist only the FINAL state on a repair round-trip.
- [x] 3.5 Add `getConversation(id, user): Future[Either[ServiceError, AuthoringConversationView]]`
      (RLS-scoped `findDisplayById`) for the new `GET` route (D7).

## 4. Backend: routes

- [x] 4.1 Wire `conversationId` through `DashboardAuthoringRoutes` for both `POST` paths.
- [x] 4.2 Add `GET /api/authoring/conversations/:id` → `getConversation`, `404` on
      `ServiceError.NotFound` (D7).

## 5. Frontend

- [x] 5.1 Extend `useDashboardAuthoringStream` to accept/return `conversationId`; add a rehydration
      call (`GET .../conversations/:id`) triggered on drawer open when a `sessionStorage`-persisted id
      exists; on `404`/failure, clear it and start fresh (D7).
- [x] 5.2 Rework `AuthoringChatDrawer`'s terminal `useEffect`: stop auto-navigating/closing on any
      result — append a `display_turns`-shaped thread entry and re-open the input for a follow-up
      instead. Add an explicit "Review & apply" control (reachable after any completed turn) that
      performs the existing `navigate("/proposals/review", {state: {proposal}})` hand-off and clears
      the stored `conversationId` (D6/D7). Persist `conversationId` to `sessionStorage` after every
      successful turn.
- [x] 5.3 Update `authoringService.ts`/`authoring.ts` types for the additive fields + the new `GET`.

## 6. Tests

- [x] 6.1 Backend: multi-turn refine (turn 2 edits turn 1's proposal, re-validated); history-budget
      trimming (stub transport's recorded request reflects only the trimmed subset); per-conversation
      ceiling rejection (0 transport invocations once exhausted); missing/non-owned `conversationId`
      → `NotFound`; `GET` returns `displayTurns`/`latestProposal` without `apiHistory`.
- [x] 6.2 Backend: `AuthoringConversationRepositorySpec` — RLS: a second user cannot read/continue the
      first user's conversation (embedded-Postgres, real RLS, not the privileged pool).
- [x] 6.3 Frontend: a second submitted message appends to the thread, not an auto-navigate; "Review &
      apply" is the only path that navigates; a reload with a stored `conversationId` rehydrates the
      thread from the `GET` response; a stale/404 id clears and starts fresh.
- [x] 6.4 Confirm the existing single-shot `DashboardAuthoringServiceSpec`/`AuthoringChatDrawer.test.tsx`
      suites (HEL-392/HEL-395) still pass unmodified for calls that never supply `conversationId`.
- [x] 6.5 `sbt test` + `npm test` + lint/format green; zero real network calls.
