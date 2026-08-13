# Files modified — HEL-397 authoring-conversation-state

Note: `git diff --name-only main...HEAD` is polluted by a stale local `main` ref in this worktree
(missing already-merged HEL-395/HEL-392/HEL-390, which this branch correctly includes) — this list
is instead the accurate working-tree diff (`git status --short`) for this executor session.

## Cycle 2 — skeptic-final-1.md change request 1 (state-leak on "Review & apply")

- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` — `handleReviewAndApply` now also
  resets `thread`/`latestProposal`/`conversationId` to their initial empty/null values (previously
  only cleared `sessionStorage` + navigated + closed). Without this, reopening the SAME mounted
  drawer instance after "Review & apply" (no full page reload — e.g. reject in Proposal Review,
  return to `/`, reopen) still showed the just-reviewed conversation's stale thread, and a follow-up
  goal was silently appended (with the old conversationId) to the already-applied conversation
  instead of starting fresh. `handleClose` (the "X"/backdrop path) is deliberately untouched — the
  skeptic confirmed resuming an in-progress draft there is intentional, not a bug.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.test.tsx` — added a `ReopenHarness` that
  mounts `AuthoringChatDrawer` OUTSIDE the `<Routes>` switch (matching the real app: the drawer's
  component instance is never unmounted by the "Review & apply" navigation) and a regression test
  reproducing the skeptic's exact repro (turn 1 → "Review & apply" → reject → reopen → assert fresh
  state, then assert a follow-up goal's request carries no `conversationId`). Verified this test
  fails without the fix (reproduces the reported stale-thread symptom) and passes with it. Extended
  `ReviewRouteProbe` with a "Reject" button (`navigate("/")`) — additive, doesn't affect any other
  test's `toHaveTextContent` (substring match) assertions.

## Backend — new files

- `backend/src/main/resources/db/migration/V77__authoring_conversations.sql` — new
  `authoring_conversations` table (`api_history`/`display_turns`/`latest_proposal`/
  `total_tokens_used`), direct-owner RLS mirroring `V75__metrics.sql` exactly. Verified V76 as the
  actual current head before naming this V77.
- `backend/src/main/scala/com/helio/api/protocols/AuthoringConversationProtocol.scala` —
  `AuthoringDisplayTurn`/`AuthoringConversationView` wire types + formats for the new `GET`
  response (display-only; `apiHistory` never included).
- `backend/src/main/scala/com/helio/infrastructure/AuthoringConversationRepository.scala` —
  `create`/`findById`/`findDisplayById`/`appendTurn`, `withUserContext`-scoped, mirrors
  `MetricRepository`'s JSONB-column-mapping conventions.
- `backend/src/main/scala/com/helio/services/AuthoringHistoryBudget.scala` — deterministic
  oldest-turn-pair-first trimming (`DefaultMaxHistoryTokens = 20000`) +
  `DefaultMaxConversationTokens = 200000`.
- `backend/src/main/scala/com/helio/services/AuthoringConversationTurns.scala` — conversation-turn
  persistence glue (`persistNew`/`persistContinuation`, deterministic assistant-turn summary),
  split out to keep `DashboardAuthoringService.scala` from growing further.
- `backend/src/test/scala/com/helio/infrastructure/AuthoringConversationRepositorySpec.scala` —
  CRUD round-trip + REAL Postgres RLS enforcement (non-superuser `helio_app_test` role, mirrors
  `RlsOwnerTablesSpec`'s harness) — a second user cannot read/continue/rehydrate the first user's
  conversation.

## Backend — modified files

- `backend/src/main/scala/com/helio/domain/model.scala` — added `AuthoringConversationId` value
  class.
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added
  `AuthoringConversationIdSegment` route-boundary path matcher.
- `backend/src/main/scala/com/helio/api/protocols/DashboardAuthoringProtocol.scala` — additive
  `conversationId` on `DashboardAuthoringRequest`/`DashboardAuthoringResponse`/
  `AuthoringStreamEvent.Result`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in
  `AuthoringConversationProtocol`.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala` — turn-1
  (no `conversationId`, unchanged behavior + transparent persistence) vs. continuation
  (`conversationId` present: load → budget check → trim → repair core, unchanged, → persist)
  dispatch for both the buffered and streaming paths; real token-usage accumulation across a
  repair round-trip; `getConversation` for the new `GET` route.
- `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala` — added
  `GET /api/authoring/conversations/:id`, same `serviceOpt`-gated 503 degrade as the `POST` route.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `AuthoringConversationRepository`
  from the existing nullable `dbContext` param into `DashboardAuthoringService`'s construction.
- `backend/src/test/scala/com/helio/services/DashboardAuthoringServiceSpec.scala` — wiring-only
  update (real `AuthoringConversationRepository` collaborator, required by the new constructor
  param) + new multi-turn/history-budget/ceiling/NotFound/streaming-continuation/`getConversation`
  coverage. Every pre-existing test scenario/assertion is unchanged.
- `backend/src/test/scala/com/helio/api/routes/DashboardAuthoringRoutesSpec.scala` — same
  wiring-only update + new `GET /api/authoring/conversations/:id` HTTP-shell coverage.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added
  `authoring_conversations` to the `rlsTables` allowlist.

## Frontend — new files

- `frontend/src/features/dashboards/utils/authoringSummary.ts` — `summarizeAuthoringProposal`,
  mirrors the backend's `AuthoringConversationTurns.summaryFor` byte-for-byte for live (non-reload)
  turn rendering.
- `frontend/src/features/dashboards/utils/authoringSummary.test.ts`
- `frontend/src/features/dashboards/services/authoringService.test.ts` — new coverage for
  `fetchAuthoringConversation` (404 → null, other failures rethrow).

## Frontend — modified files

- `frontend/src/features/dashboards/types/authoring.ts` — additive `conversationId` fields +
  `AuthoringDisplayTurn`/`AuthoringConversationView` types.
- `frontend/src/features/dashboards/services/authoringService.ts` — added
  `fetchAuthoringConversation` (GET, 404 → null).
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts` — accepts/threads
  `conversationId` through the POST body and the effect's dependency array.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.test.ts` — new
  `conversationId` pass-through coverage; every pre-existing test is unmodified (byte-identical
  `JSON.stringify` body since `JSON.stringify` omits an `undefined`-valued key).
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` — **the D6 rework**: the terminal
  `useEffect` no longer auto-navigates/closes — it appends a `display_turns`-shaped entry to a new
  local `thread` state and re-opens the input; a new "Review & apply" control performs the
  navigate+close hand-off explicitly; `conversationId` persisted to/read from `sessionStorage`
  (D7), with reload rehydration via `fetchAuthoringConversation` on open.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.css` — thread-entry + "Review & apply"
  button styling (DESIGN.md tokens only).
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.test.tsx` — one pre-existing test
  (asserting the now-removed auto-navigate-on-result behavior) rewritten into two tests matching
  D6 (turn completion appends to thread and stays open; "Review & apply" is the only path that
  navigates) — this is the one deliberate behavior-visible test change, required by the design-gate
  fix (see final report for the "unmodified tests" reasoning). Added multi-turn, reload-rehydration,
  and stale-id-degradation coverage. Every other pre-existing test/assertion is unchanged.

## Schemas

- `schemas/dashboard-authoring-request.schema.json` — additive `conversationId` property.
- `schemas/dashboard-authoring-response.schema.json` — additive, now-required `conversationId`
  property.
- `schemas/authoring-conversation.schema.json` — new schema for `AuthoringConversationView`.
