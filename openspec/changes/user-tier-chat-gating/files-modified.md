# Files Modified: user-tier-chat-gating (HEL-703)

## Backend — new files

- `backend/src/main/resources/db/migration/V88__user_tier.sql` — adds `users.tier` (`TEXT` + `CHECK`, default `free`) and the `assistant_daily_usage` table (full RLS: `ENABLE`/`FORCE ROW LEVEL SECURITY` + owner policy), per design.md D1/D5. Migration number pinned at V88 (V87 belongs to in-flight HEL-698).
- `backend/src/main/scala/com/helio/services/UserTierConfig.scala` — `fromEnv()` config: `HELIO_OWNER_EMAILS` allowlist (comma/trim/lowercase) + `HELIO_BETA_DAILY_MESSAGE_LIMIT` (default 50, <1 clamped to 0).
- `backend/src/main/scala/com/helio/services/ChatAccessService.scala` — resolves tier per-request (`guard`) and enforces the beta daily cap (`checkConverseCap`); owner uncounted, free denied.
- `backend/src/main/scala/com/helio/services/ChatAccessError.scala` — `TierForbidden` (403) / `LimitReached` (429) error ADTs backing `TierErrorResponse`.
- `backend/src/main/scala/com/helio/infrastructure/AssistantDailyUsageRepository.scala` — atomic `INSERT ... ON CONFLICT ... WHERE message_count < :limit RETURNING` cap increment, routed through `DbContext.withUserContext`.

## Backend — modified files

- `backend/src/main/scala/com/helio/domain/model.scala` — `sealed trait UserTier` (Free/Beta/Owner, wire parse/render); `User.tier` field.
- `backend/src/main/scala/com/helio/infrastructure/UserRepository.scala` — widened `UserRow` (7→8 tuple), `insert`/`upsertGoogleUser` row builds carry tier; new `updateTier`.
- `backend/src/main/scala/com/helio/services/AuthService.scala` — 2nd constructor arg `UserTierConfig`; `register` assigns tier at insert; `login` promotes allowlisted non-owner; `completeOAuth` assigns-on-create / promotes-on-return.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `UserTierConfig.fromEnv()` into `AuthService` and `ChatAccessService` into `AssistantConversationRoutes`.
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` — wraps the entire route family in the tier-gate directive; converse additionally runs the cap check before invoking the model.
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` — `TierErrorResponse(code, message, limit)` JSON format.
- `backend/src/main/scala/com/helio/api/protocols/AuthProtocol.scala` — `tier` added to the shared user JSON format (register/login/OAuth/`/api/auth/me`).

## Backend — new tests

- `backend/src/test/scala/com/helio/domain/UserTierSpec.scala` — `UserTier` parse/render round-trip.
- `backend/src/test/scala/com/helio/infrastructure/UserTierMigrationSpec.scala` — V88 schema assertions (default/CHECK, existing rows backfill `free`).
- `backend/src/test/scala/com/helio/infrastructure/AssistantDailyUsageRepositorySpec.scala` — atomic cap increment (boundary-exact, concurrent-safe, per-UTC-day keyed) + real-Postgres RLS cross-user isolation on `assistant_daily_usage`.
- `backend/src/test/scala/com/helio/services/UserTierConfigSpec.scala` — `fromEnv()` parsing edge cases.
- `backend/src/test/scala/com/helio/services/AuthServiceSpec.scala` — register/login tier assignment + promotion, case-insensitive match, no demotion, unset allowlist no-op.

## Backend — modified tests

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — `tier` present in register/login/`/me` responses.
- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — first-login/returning-login tier assignment via `new AuthService(userRepo, testConfig)`; fallback invalid email never matches.
- `backend/src/test/scala/com/helio/api/routes/AssistantConversationRoutesSpec.scala` — free 403 `TIER_FORBIDDEN` on every endpoint (nothing persisted); beta under/at-cap converse; owner past-limit converse; usage-table write assertions.
- `backend/src/test/scala/com/helio/api/routes/AssistantTelemetrySpec.scala` — constructor call site updated with an owner-tier fixture so telemetry's model-call assertions are unaffected by the new gate.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — `"assistant_daily_usage"` added to `rlsTables`.

## Frontend — modified files

- `frontend/src/features/auth/types/user.ts` — `tier: "free" | "beta" | "owner"` on `User`.
- `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — `converse` thunk's `rejectValue` widened to `ConverseErrorPayload { code?, message, limit? }`; other thunks unchanged (string). **Cycle 2:** also exports `TierRequestAccessCopy` (`{ title, description }`), the single source of truth for the free-tier locked-state copy, now shared by `ActiveConversationPanel.tsx` and `SidebarBody.tsx` instead of each carrying its own string literal.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` — renders a CTA-less request-access `EmptyState` for `tier === "free"`; guards the `selectConversation` dispatch. **Cycle 2:** its inline copy strings replaced with the shared `TierRequestAccessCopy` import (no behavior change — same rendered text).
- `frontend/src/features/assistant/ui/ChatPage.tsx` — guards the `fetchConversations` dispatch on free tier (`/chat` surface).
- `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx` — same guard, quick-launcher surface.
- `frontend/src/features/assistant/ui/MessageComposer.tsx` — switches on `code`: `CHAT_LIMIT_REACHED` → distinct limit-reached notice (transcript stays visible); `TIER_FORBIDDEN` → inline access-revoked message; generic errors unchanged.
- **`frontend/src/shared/chrome/SidebarBody.tsx` (cycle 2, evaluation-1.md CR1) — the missed THIRD `fetchConversations` dispatch site.** Its own "chat"-section `useEffect` branch is now gated on `currentUser?.tier === "free"` (mirroring `ChatPage.tsx`/`QuickLauncherOverlay.tsx`), and — because a gated fetch alone would have left `conversations.status` at `"idle"` with an empty list, falling through to `SidebarItemList`'s own generic "No conversations yet" + "+ New chat" empty state — the "chat" section now short-circuits BEFORE `SidebarItemList` entirely for a free-tier user, rendering a bespoke, CTA-less, `variant="sidebar"` `EmptyState` (no heading/filter/"+") using the shared `TierRequestAccessCopy`. See design.md D9's correction and tasks.md 5.5 for the full writeup.

## Frontend — modified tests

- `frontend/src/features/assistant/ui/ActiveConversationPanel.test.tsx` — free/beta/owner tier-gating scenarios; `CHAT_LIMIT_REACHED`/`TIER_FORBIDDEN` composer-error rendering (transcript-visible assertion).
- `frontend/src/features/assistant/state/assistantConversationsSlice.test.ts` — converse rejectValue shape.
- `frontend/src/features/auth/state/authSlice.test.ts`, `frontend/src/features/auth/ui/OAuthCallbackPage.test.tsx`, `frontend/src/features/auth/ui/UserMenu.test.tsx`, `frontend/src/features/panels/ui/PanelList.test.tsx`, `frontend/src/app/App.test.tsx` — fixture `User` objects updated with the new required `tier` field.
- **`frontend/src/shared/chrome/SidebarBody.test.tsx` (cycle 2, tasks.md 6.10)** — `makeStore` now wires the `auth` reducer (previously absent from this file's own store builder entirely) with a `currentUser` option (default `null`, preserving every pre-existing test's behavior unchanged). Three new tests: a free-tier user sees the locked state with no raw error, no generic empty state, no "+ New chat" CTA, no filter box, and `listConversations` is never called; beta- and owner-tier users still see the normal, ungated chat section.

## Deploy / docs

- `CLAUDE.md` — documents `HELIO_OWNER_EMAILS` and `HELIO_BETA_DAILY_MESSAGE_LIMIT` in the production env-var table.
- `infra/.env.deploy.example` — adds `HELIO_OWNER_EMAILS` (prod value `mattheworr018@gmail.com`) and commented-out `HELIO_BETA_DAILY_MESSAGE_LIMIT` override.
- `infra/deploy-backend.sh` — passes both vars through `--set-env-vars`, defaulting `HELIO_BETA_DAILY_MESSAGE_LIMIT` to 50 when unset in `.env.deploy` so the script never emits an empty value.

## Note on task 6.8 (local end-to-end)

Task 6.8 was already checked off by the interrupted prior session. The session before this one found
circumstantial evidence a live run happened (the `assistant_daily_usage` table exists in the
worktree's dev DB `helio_hel703`, meaning `sbt run`/tests against it applied V88 at least once), but
found **no artifact** (log, screenshot, curl transcript, or note) proving the specific manual flows
described in 6.8 (owner signup via `HELIO_OWNER_EMAILS`, free-signup request-access view, beta-at-cap
limit notice) were actually driven through the running dev server. That honest flag turned out to be
exactly right: the evaluator's own live browser pass supplied the missing free-tier verification and
found the `SidebarBody.tsx` gap this cycle-2 pass fixes (evaluation-1.md CR1/CR2).

## Cycle-2 tooling note (evaluation-1.md CR2)

This session does not have browser-automation tooling available (no Playwright MCP tool, and
`@playwright/test` is not installed anywhere in this worktree or the base repo's `node_modules` —
confirmed via `find`; `npx playwright` only resolves a throwaway CLI-only copy with no
`@playwright/test` module to satisfy `playwright.config.ts`'s import, and installing one would write
under `~/.npm`/`~/.cache` without the explicit "Approved" `CLAUDE.md`'s file-system-permissions
policy requires for changes under the home directory). Re-verified CR2 by the closest means available
instead:

1. `SidebarBody.test.tsx`'s three new tests (tasks.md 6.10) assert the exact DOM conditions the
   evaluator's live repro found missing: the locked state renders, the generic empty state and its
   "+ New chat" CTA do not, the filter box does not, and `listConversations` is never called for a
   free-tier user — with beta/owner regression coverage alongside.
2. Confirmed via `curl http://localhost:6135/src/shared/chrome/SidebarBody.tsx` that the dev server
   the evaluator left running is serving the fixed source live through Vite HMR (no restart needed) —
   whoever performs the actual browser click-through (skeptic) will see the fix.
3. Fresh `curl` round trip against `BACKEND_PORT=9042` (register → `/me` → `GET
   /api/assistant-conversations`) confirms a brand-new signup is `tier: "free"` and still gets `403
   TIER_FORBIDDEN` — the backend half is unchanged and correct (this cycle's fix is frontend-only).

Both dev servers were left running and healthy (`/health` on 9042, `200` on 6135) for the skeptic's
own live pass, unchanged from how the evaluator left them.
