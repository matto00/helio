# Tasks: beta-invite-code-redemption

## 1. Setup

- [x] 1.1 Create fresh dev DB `helio_hel704` and point this worktree's gitignored `backend/.env` `DATABASE_URL` at it (env-only, never committed)

### Backend

## 2. Data layer

- [x] 2.1 Add `V90__invite_codes.sql` per design D1 (columns, index on policy predicate, ENABLE+FORCE RLS, `user_id = current_setting('app.current_user_id')::uuid` policy, header comment citing HEL-704 + why V89 is skipped)
- [x] 2.2 Add `InviteCodeRepository(ctx: DbContext)` with transactional `redeemAndUpgrade(userId, codeHash)` per design D3 (raw-SQL conditional-update-returning + guarded users tier update, `.transactionally`; no Slick table needed if raw SQL suffices, per `AssistantDailyUsageRepository` precedent)
- [x] 2.3 Add `invite_codes` to `RlsPolicyGuardSpec.rlsTables`

## 3. Email capability

- [x] 3.1 Add `com.helio.email`: `EmailConfig.fromEnv()` (`RESEND_API_KEY`, `HELIO_EMAIL_FROM`, redacting toString), `EmailSender` trait, `HttpResendEmailSender` per design D6 (HttpClaudeTransport connection-settings pattern, key never logged)

## 4. Service + routes

- [x] 4.1 Add `BetaAccessError` ADT + `BetaAccessService(inviteCodeRepo, userRepo, tierConfig, emailSender: Option[EmailSender])` per design D4/D5 (free-only checks, owner email body, 1h in-memory cooldown, redeem returns updated `User`)
- [x] 4.2 Add `RequestValidation.validateRedeemInviteCodeRequest` (trim, non-empty, ≤128 chars)
- [x] 4.3 Add `BetaAccessProtocol` (redeem request case class + formats), extend `JsonProtocols` list + header comment
- [x] 4.4 Add `BetaAccessRoutes` (`POST /api/beta-access/request`, `POST /api/beta-access/redeem` → updated `UserResponse`) with bespoke error completions per D5
- [x] 4.5 Wire `Main.scala` + `ApiRoutes.scala`: construct repo/email sender/service, mount routes in authenticate branch (minimal-diff wiring, HEL-702 overlap awareness) — `Main.scala` needed no change: `dbContext`/`userRepo`/`userTierConfig` were already threaded through; `EmailConfig.fromEnv()`/`InviteCodeRepository`/`BetaAccessService` are all constructed inside `ApiRoutes` from existing params, same as the `ClaudeConfig.fromEnv()` precedent

## 5. Ops + contract artifacts

- [x] 5.1 Add `backend/scripts/issue-invite-code.sql` per design D9 (resolve user by email, generate code, insert hash, print plaintext once, BYPASSRLS header note)
- [x] 5.2 Add `schemas/redeem-invite-code-request.schema.json`; add `RESEND_API_KEY`/`HELIO_EMAIL_FROM` rows to CLAUDE.md env table + `.env.example` entries

### Frontend

## 6. Settings Beta access UI

- [x] 6.1 Add `requestBetaAccess()`/`redeemInviteCode(code)` to `settingsService.ts` (types per contract; redeem returns user)
- [x] 6.2 Extend `settingsSlice` with `betaAccess` sub-tree (request/redeem status+error, thunks; redeem thunk dispatches `setAuth({user})` on success)
- [x] 6.3 Add `BetaAccessSection` component + CSS (tier-aware per spec `settings-beta-access-ui`, PreferencesEditor patterns, DESIGN.md tokens) and mount as third `SettingsPage` section

### Tests

## 7. Tests

- [x] 7.1 `InviteCodeRepositorySpec` (embedded PG + Flyway): redeem success sets `redeemed_at` + tier beta in one transaction; second redeem fails; foreign-user code fails; unknown code fails; owner/beta tier never downgraded; RLS cross-user isolation
- [x] 7.2 `BetaAccessServiceSpec` (stub `EmailSender`): request happy path includes requester identity + all owner recipients; non-free 409; cooldown 429; unconfigured 503-shape; send-failure 502-shape; redeem maps repo outcomes + returns updated user
- [x] 7.3 `HttpResendEmailSender` unit spec: request construction (URL, bearer header, from/to/subject/text body); no key in logs/errors
- [x] 7.4 `BetaAccessRoutesSpec` (ScalatestRouteTest): status codes per spec scenarios incl. 400 invalid-code message; `ApiRoutesSpec` 401 entries for both endpoints
- [x] 7.5 Frontend: `settingsSlice` betaAccess reducer/thunk tests (incl. `setAuth` dispatch on redeem success); `BetaAccessSection.test.tsx` per-tier rendering + inline outcomes
- [x] 7.6 Run full gates (backend `sbt test`, frontend lint/format/jest, schema/openspec hygiene scripts)
