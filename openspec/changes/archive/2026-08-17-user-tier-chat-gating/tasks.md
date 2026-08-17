# Tasks: user-tier-chat-gating

## 1. Backend — data model + config

### Backend

- [x] 1.1 Write `V88__user_tier.sql`: `users.tier TEXT NOT NULL DEFAULT 'free'` + CHECK (`free|beta|owner`), and `assistant_daily_usage(user_id UUID REFERENCES users(id), usage_date DATE, message_count INT NOT NULL, PRIMARY KEY(user_id, usage_date))` with `ENABLE` + `FORCE ROW LEVEL SECURITY` + owner policy (`user_id = current_setting('app.current_user_id')::uuid`) per `api_tokens`/`assistant_conversations` precedent (D1/D5; number MUST stay V88 — V87 is HEL-698's)
- [x] 1.2 Add `sealed trait UserTier` (Free/Beta/Owner + wire names + parse) in `domain/model.scala`; add `tier: UserTier` to `User`
- [x] 1.3 Widen `UserRepository` mapping (`UserRow` 7→8-tuple, `def *`, `insert`, `upsertGoogleUser` row builds); add `updateTier(id, tier)`; `upsertGoogleUser` gains the tier-on-create/promote-on-return behavior (D4)
- [x] 1.4 Add `UserTierConfig.fromEnv()` reading `HELIO_OWNER_EMAILS` (comma-split/trim/lowercase) + `HELIO_BETA_DAILY_MESSAGE_LIMIT` (int, default 50, <1 ⇒ 0) per `ClaudeConfig`/`CookieConfig` pattern
- [x] 1.5 Add `AssistantDailyUsageRepository` routed through `DbContext.withUserContext` (never raw `db.run`) with the single atomic conditional upsert-increment (`ON CONFLICT ... DO UPDATE ... WHERE message_count < :limit RETURNING`); add `"assistant_daily_usage"` to `RlsPolicyGuardSpec.rlsTables` (D5)

## 2. Backend — tier assignment on auth paths

### Backend

- [x] 2.1 Thread `UserTierConfig` into `AuthService` (2nd constructor arg; `ApiRoutes.scala` passes `fromEnv()`); `register` assigns owner-vs-free at insert; `login` promotes allowlisted non-owner via `updateTier` before the response (D4)
- [x] 2.2 `completeOAuth`: assign tier on first-login create, promote allowlisted returning user (alongside existing avatar refresh); update `GoogleOAuthRoutesSpec` fixture construction (`new AuthService(userRepo, testConfig)`)
- [x] 2.3 Add `tier` to the user JSON (register/login/OAuth/`GET /api/auth/me` responses) via the shared user format in `JsonProtocols`/protocols (D8)

## 3. Backend — assistant gating

### Backend

- [x] 3.1 Add `ChatAccessService`: `findById` → tier; free ⇒ deny `TIER_FORBIDDEN`; beta converse ⇒ atomic cap increment or `CHAT_LIMIT_REACHED(limit)`; owner ⇒ allow uncounted (D3/D5/D6)
- [x] 3.2 Add `TierErrorResponse(code, message, limit: Option[Int])` + JSON format; 403/429 completion helpers reusing `ServiceResponse.statusCodeFor` where applicable (D7)
- [x] 3.3 Gate ALL `AssistantConversationRoutes` endpoints (list/create/get/messages/converse/patch) with the tier check wrapper; converse additionally runs the cap check before `assistantService.converse`; over-cap persists no turns and calls no model (D7)
- [x] 3.4 Wire construction: pass `ChatAccessService` into `AssistantConversationRoutes` at `ApiRoutes.scala` mount; build the service in `Main.scala`/`ApiRoutes` with `UserTierConfig.fromEnv()`; update BOTH test-side constructor call sites — `AssistantConversationRoutesSpec` AND `AssistantTelemetrySpec.scala:129` (telemetry fixtures need a tier/quota that still reaches the model call, e.g. owner) (D7)

## 4. Backend — deploy plumbing + docs

### Backend

- [x] 4.1 Document `HELIO_OWNER_EMAILS` + `HELIO_BETA_DAILY_MESSAGE_LIMIT` in `CLAUDE.md` env table; add to `infra/.env.deploy.example` + wire through `infra/deploy-backend.sh` (prod allowlist value: `mattheworr018@gmail.com`, set at deploy, not committed) (D10)
- [x] 4.2 Write the AC-#3 post-deploy verification checklist (set `HELIO_OWNER_EMAILS=mattheworr018@gmail.com` on Cloud Run via `.env.deploy`, deploy, log in as that account on prod, confirm `/api/auth/me` shows `owner` and converse works past the beta limit) — goes verbatim into the PR body and the Linear closing comment as a tracked manual step (D10)

## 5. Frontend

### Frontend

- [x] 5.1 Add `tier: "free" | "beta" | "owner"` to `features/auth/types/user.ts` `User` (flows via existing `/api/auth/me` → `authSlice`)
- [x] 5.2 Widen the CONVERSE thunk's error extraction to `{ code?, message, limit? }` (`rejectValue` object for converse only; other thunks keep `string`; `converse.rejected` stays un-reduced/composer-local per existing comment) (D9)
- [x] 5.3 `ActiveConversationPanel`: render request-access `EmptyState` — title/description only, NO `cta`, no composer — when `currentUser.tier === "free"`, and guard the `fetchConversations` dispatch on free tier; covers `/chat` (via `ChatPage.tsx`'s own guarded dispatch) + quick launcher (via `QuickLauncherOverlay.tsx`'s own guarded dispatch) (D9). **Cycle-2 correction (evaluation-1.md CR1):** this task's checkbox originally overstated scope — a THIRD `fetchConversations` dispatch site, `SidebarBody.tsx`'s own "chat" section effect (the sidebar list, distinct from the two components named above), was missed and shipped ungated, so a free-tier user on `/chat` saw a raw "Failed to load conversations." in the sidebar. See task 5.5.
- [x] 5.4 `MessageComposer`: switch on error code — `CHAT_LIMIT_REACHED` ⇒ distinct "daily limit reached (resets daily)" notice with transcript visible; `TIER_FORBIDDEN` ⇒ inline access-revoked message; generic errors unchanged (D9)
- [x] 5.5 **(cycle-2 fix, evaluation-1.md CR1)** `SidebarBody.tsx`: guard its own `fetchConversations` dispatch (the "chat" section's list-driving effect, `useEffect` at the top of the component — a THIRD site 5.3 missed) on `currentUser?.tier === "free"`, and render the same CTA-less locked `EmptyState` (`variant="sidebar"`, shared copy via the new `TierRequestAccessCopy` export in `assistantConversationsSlice.ts` so the sidebar and `ActiveConversationPanel` can never drift apart) instead of falling through to `SidebarItemList`'s generic "No conversations yet" + "+ New chat" empty state, which would otherwise render once the fetch is gated (D9)

## 6. Tests

### Tests

- [x] 6.1 Backend: V88 schema assertions (tier default/CHECK; existing rows backfilled `free`) in the user-persistence-adjacent spec; `UserTier` parse round-trip
- [x] 6.2 Backend: `AuthService`/`ApiRoutesSpec` — register default free; register allowlisted ⇒ owner; login promotes free→owner (persisted + in response); case-insensitive match; unset allowlist no-op; no demotion; `tier` present in register/login/me responses
- [x] 6.3 Backend: `GoogleOAuthRoutesSpec` — first-login create assigns per allowlist; returning login promotes; fallback `google:<sub>@helio.invalid` email never matches
- [x] 6.4 Backend: `AssistantConversationRoutesSpec` — free user 403 `TIER_FORBIDDEN` on every endpoint with nothing persisted; beta under-cap converse OK; beta at-cap converse 429 `CHAT_LIMIT_REACHED` + limit, no model call, no turns persisted; beta at-cap list/get still 200; owner past-beta-limit converse OK, usage table not written
- [x] 6.5 Backend: `AssistantDailyUsageRepository` atomic increment — cap boundary exact, concurrent increments never exceed limit, per-UTC-day keying; RLS cross-user isolation on `assistant_daily_usage` (one user's context cannot read/write another's row)
- [x] 6.6 Frontend: `ActiveConversationPanel.test.tsx` — free tier shows request-access state (no composer, no raw error); beta/owner render normal panel
- [x] 6.7 Frontend: `MessageComposer`/slice tests — `CHAT_LIMIT_REACHED` renders limit notice with transcript visible; `TIER_FORBIDDEN` falls back to request-access; generic error path unchanged; `renderWithStore` `TestState` updated for any new state fields
- [x] 6.8 Local end-to-end via the real env mechanism (AC #3 in-run half): `HELIO_OWNER_EMAILS` set in worktree `backend/.env`, sign up that email, verify `/me` returns `owner` and converse succeeds past the beta limit; free signup sees request-access; beta (direct DB `UPDATE users SET tier='beta'`) at cap sees limit notice. **Cycle-2 note (evaluation-1.md CR2):** this claim was unverified-by-the-executor's-session for the free-tier scenario specifically (see files-modified.md's original note); the evaluator's own live browser pass supplied that verification and found the 5.5 gap. This session could not re-drive a real browser itself (`@playwright/test` is not installed anywhere in this worktree/repo tree — see files-modified.md); re-verified instead via (a) `SidebarBody.test.tsx`'s new tier-gating tests (6.10) asserting the exact DOM the evaluator's repro checked, and (b) confirming live via `curl` that the running dev server (DEV_PORT=6135, left up by the evaluator) is serving the fixed `SidebarBody.tsx` source through Vite HMR, plus a fresh backend-level free-tier signup/`  /me`/403 round trip against BACKEND_PORT=9042. A real-browser click-through of the fix is left to the evaluator/skeptic's own Playwright tooling.
- [x] 6.9 Gates: `sbt test`, `npm test`, `npm run lint`, `npm run format:check` all green in the worktree
- [x] 6.10 **(cycle-2, evaluation-1.md CR1/CR2)** Frontend: `SidebarBody.test.tsx` — free-tier user sees the CTA-less locked state in the "chat" section (no generic "No conversations yet" empty state, no "+ New chat" CTA, no filter box) and `fetchConversations` is never dispatched; beta/owner still see the normal, ungated chat section (list fetch fires, "New chat" present) — regression coverage for both tiers so the gate can't silently reopen
