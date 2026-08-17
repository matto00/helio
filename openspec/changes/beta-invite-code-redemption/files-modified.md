# Files Modified — HEL-704 beta-invite-code-redemption

## Backend — data layer

- `backend/src/main/resources/db/migration/V90__invite_codes.sql` — new `invite_codes` table (single-use, recipient-bound, sha256-hashed codes), direct-owner RLS (ENABLE+FORCE+policy), index on the policy predicate. Migration number V90 (V89 deliberately skipped — claimed by in-flight sibling HEL-702).
- `backend/src/main/scala/com/helio/infrastructure/InviteCodeRepository.scala` — new; `redeemAndUpgrade` runs the code-consumption UPDATE and the guarded `users.tier` UPDATE atomically in one `.transactionally` action under `ctx.withUserContext`, without touching `UserRepository.scala` (HEL-702 overlap-minimizing constraint).
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added `invite_codes` to the `rlsTables` allowlist.

## Backend — email capability

- `backend/src/main/scala/com/helio/email/EmailConfig.scala` — new; `RESEND_API_KEY`/`HELIO_EMAIL_FROM` env config, redacted `toString`.
- `backend/src/main/scala/com/helio/email/EmailSender.scala` — new; `EmailSender` trait (injectable, stub-friendly).
- `backend/src/main/scala/com/helio/email/HttpResendEmailSender.scala` — new; production `EmailSender` over the Resend REST API, mirrors `HttpClaudeTransport`'s connection-settings pattern.

## Backend — service + routes

- `backend/src/main/scala/com/helio/services/BetaAccessError.scala` — new; bespoke error ADT (`EmailUnconfigured`/`NotEligible`/`Cooldown`/`SendFailed`/`InvalidCode`) for statuses `ServiceError` has no case for.
- `backend/src/main/scala/com/helio/services/BetaAccessService.scala` — new; `requestAccess`/`redeem` orchestration — tier checks, owner-email body, in-memory 1h cooldown, atomic redemption via `InviteCodeRepository`.
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — added `validateRedeemInviteCodeRequest` (trim, non-empty, ≤128 chars).
- `backend/src/main/scala/com/helio/api/protocols/BetaAccessProtocol.scala` — new; `RedeemInviteCodeRequest` + JSON format.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `BetaAccessProtocol`.
- `backend/src/main/scala/com/helio/api/routes/BetaAccessRoutes.scala` — new; `POST /api/beta-access/request` + `POST /api/beta-access/redeem`, bespoke error completions, redeem returns `UserResponse.fromDomain`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wired `EmailConfig.fromEnv()`/`InviteCodeRepository`/`BetaAccessService` (nullable-optional pattern on `dbContext`), mounted `BetaAccessRoutes` in the authenticated branch.

## Backend — ops + contract artifacts

- `backend/scripts/issue-invite-code.sql` — new; owner-side manual issuance script (resolve by email, generate + hash code, print plaintext once), documented BYPASSRLS requirement.
- `schemas/redeem-invite-code-request.schema.json` — new; JSON Schema for `RedeemInviteCodeRequest`.
- `CLAUDE.md` — added `RESEND_API_KEY`/`HELIO_EMAIL_FROM` env-table rows; noted `HELIO_OWNER_EMAILS` reuse as the request-access recipient list.
- `backend/.env.example` — added commented `RESEND_API_KEY`/`HELIO_EMAIL_FROM`/`HELIO_OWNER_EMAILS` entries.

## Frontend

- `frontend/src/features/settings/services/settingsService.ts` — added `requestBetaAccess()`/`redeemInviteCode(code)`.
- `frontend/src/features/settings/state/settingsSlice.ts` — added `betaAccess` sub-tree + `requestBetaAccessThunk`/`redeemInviteCodeThunk` (the latter dispatches `setAuth({ user })` on success, unlocking tier-gated UI without re-login).
- `frontend/src/features/settings/ui/BetaAccessSection.tsx` + `.css` — new; tier-aware Settings section (request button + code field for `free`, confirmation for `beta`/`owner`).
- `frontend/src/features/settings/ui/SettingsPage.tsx` — mounted `BetaAccessSection` as the third section.

## Tests

- `backend/src/test/scala/com/helio/infrastructure/InviteCodeRepositorySpec.scala` — new; embedded PG + Flyway, dual-pool RLS harness.
- `backend/src/test/scala/com/helio/services/BetaAccessServiceSpec.scala` — new; embedded PG + Flyway, stub `EmailSender`.
- `backend/src/test/scala/com/helio/email/HttpResendEmailSenderSpec.scala` — new; request-shape assertions only, no real network call.
- `backend/src/test/scala/com/helio/api/routes/BetaAccessRoutesSpec.scala` — new; `ScalatestRouteTest`, dual-pool harness.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added 401 coverage for both new endpoints.
- `frontend/src/features/settings/state/settingsSlice.test.ts` — added `betaAccess` reducer/thunk tests, including `setAuth` dispatch assertion on redeem success.
- `frontend/src/features/settings/ui/BetaAccessSection.test.tsx` — new; per-tier rendering + inline request/redeem outcomes.
- `frontend/src/features/settings/ui/AgentMemoryList.test.tsx` — added the new `betaAccess` sub-tree to its hand-rolled `preloadedState` literal (widened `SettingsState` broke this pre-existing test's TypeScript compilation; unrelated to this file's own behavior).
