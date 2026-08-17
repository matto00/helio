# Files Modified: add-totp-mfa (HEL-702)

## Backend

- `backend/build.sbt` — adds `java-otp` + `commons-codec` dependencies (design.md D1).
- `backend/src/main/resources/db/migration/V89__totp_mfa.sql` — new `user_mfa`, `mfa_backup_codes`, `mfa_login_challenges` tables, no RLS (design.md D2).
- `backend/src/main/scala/com/helio/domain/Mfa.scala` — `UserMfa`, `MfaLoginChallenge` domain case classes.
- `backend/src/main/scala/com/helio/infrastructure/MfaRepository.scala` — raw-Slick CRUD for the three MFA tables.
- `backend/src/main/scala/com/helio/infrastructure/TotpSupport.scala` — secret generation, otpauth URI, ±1-step verify with replay guard (design.md D5).
- `backend/src/main/scala/com/helio/services/MfaService.scala` — enrollment/backup-code/disable/login-challenge business logic. Cycle-2 fix (evaluation-1.md CR1): all 8 `ServiceError.Unauthorized()` call sites shared one `InvalidCode = ServiceError.Unauthorized("Invalid or expired code")` constant instead of inheriting the password-login default message ("Invalid email or password"); uniformity across MFA failure modes (no oracle) is unchanged, only the text.
- `backend/src/main/scala/com/helio/services/AuthService.scala` — `LoginOutcome` sealed trait; `mfaService: Option[MfaService] = None` ctor param; single `finishLogin` call site gates the password-login success branch and `completeOAuth` (design.md D3).
- `backend/src/main/scala/com/helio/api/protocols/MfaProtocol.scala` — MFA request/response JSON formats.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `MfaProtocol`.
- `backend/src/main/scala/com/helio/api/routes/MfaRoutes.scala` — authenticated enrollment/status/backup-code/disable routes + public login-time verify route.
- `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` — login branches on `LoginOutcome` (`SessionEstablished` vs `MfaRequired`).
- `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` — OAuth callback branches on `LoginOutcome` identically to `AuthRoutes`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `MfaService`/`MfaRoutes` into the authenticated + public route trees.
- `backend/src/main/scala/com/helio/api/package.scala` — supporting wiring for the above.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `MfaService`/`MfaRepository` and passes them through.
- `backend/src/test/scala/com/helio/infrastructure/TotpSupportSpec.scala` — RFC 6238 vectors, window/replay tests.
- `backend/src/test/scala/com/helio/services/MfaServiceSpec.scala` — enrollment/backup-code/challenge lifecycle tests.
- `backend/src/test/scala/com/helio/api/MfaApiRoutesSpec.scala` — route-level MFA tests (independent spec file, mirrors `GoogleOAuthRoutesSpec`). Cycle-2: added `responseAs[ErrorResponse].message shouldBe "Invalid or expired code"` assertions to the wrong-code/unknown-challenge tests across all four MFA failure surfaces (login verify, enroll confirm, regenerate, disable), locking in CR1's fix.
- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — adds the MFA-enabled OAuth-callback case (challenge, no cookie).

## Schemas

- `schemas/mfa-enroll-response.schema.json`, `schemas/mfa-required-response.schema.json`, `schemas/mfa-status-response.schema.json`, `schemas/mfa-verify-request.schema.json` — wire contracts for the four MFA response/request shapes with a dedicated schema (2020-12).

## Frontend

- `frontend/package.json`, `frontend/package-lock.json` — adds `qrcode.react` (design.md D1).
- `frontend/src/features/auth/types/user.ts` — `MfaRequiredResponse`, `LoginResult` union, `MfaStatusResponse`, `MfaEnrollResponse`, `MfaBackupCodesResponse` types.
- `frontend/src/features/auth/services/authService.ts` — `mfaStatusRequest`/`mfaEnrollRequest`/`mfaConfirmRequest`/`mfaRegenerateRequest`/`mfaDisableRequest`/`mfaVerifyRequest`; `loginRequest`/`oauthCallbackRequest` return `LoginResult`.
- `frontend/src/features/auth/state/authSlice.ts` — `mfaChallenge` transient state, `verifyMfa` thunk, `isMfaRequiredResponse` guard; `login`/`handleOAuthCallback` fulfilled reducers branch on the MFA gate; `clearAuth` clears the challenge.
- `frontend/src/features/auth/ui/LoginPage.tsx`, `frontend/src/features/auth/ui/OAuthCallbackPage.tsx` — navigate to `/login/verify` instead of `/` when the response is `MfaRequiredResponse`.
- `frontend/src/features/auth/ui/MfaVerifyPage.tsx` (new) — public `/login/verify` page: code entry + backup-code toggle, redirects to `/login` with no pending challenge.
- `frontend/src/features/auth/ui/auth.css` — `.auth-link-btn` (ghost-recipe toggle button) for the verify page.
- `frontend/src/app/App.tsx` — registers the `/login/verify` route inside the `PublicOnlyRoute` group.
- `frontend/src/services/httpClient.ts` — extends the global 401-redirect interceptor's exemption list to `/api/auth/mfa/*` (see rationale below).
- `frontend/src/features/settings/state/settingsSlice.ts` — new `mfa` state sub-tree + `fetchMfaStatus`/`startMfaEnrollment`/`confirmMfaEnrollment`/`regenerateMfaBackupCodes`/`disableMfa` thunks + `dismissMfaEnrollment`/`dismissMfaBackupCodes` reducers.
- `frontend/src/features/settings/ui/MfaSecuritySection.tsx` (new) + `.css` — status view, enroll trigger, regenerate/disable inline re-auth prompts. Cycle-2 fix (evaluation-1.md CR2): `.mfa-security-section__confirm-btn--danger`'s hardcoded `color: #ffffff` replaced with `color: var(--app-bg)`, matching `SourceDetailPanel.css`/`TypeDetailPanel.css`'s existing danger-confirm-button token precedent (DESIGN.md mechanical rule).
- `frontend/src/features/settings/ui/MfaEnrollModal.tsx` (new) + `.css` — self-starting enroll modal: QR + manual key → confirm code → one-time backup codes.
- `frontend/src/features/settings/ui/MfaBackupCodesList.tsx` (new) + `.css` — shared one-time backup-codes presentational component (used by both the enroll modal and the regenerate flow).
- `frontend/src/features/settings/ui/SettingsPage.tsx` — mounts a new "Security" section rendering `MfaSecuritySection`.

## Tests (new/updated)

- `frontend/src/features/auth/state/authSlice.test.ts` — MFA-gate branches for `login`/`handleOAuthCallback`, `verifyMfa` success/failure/no-challenge, `clearAuth` clearing the challenge.
- `frontend/src/features/auth/ui/LoginPage.test.tsx`, `frontend/src/features/auth/ui/OAuthCallbackPage.test.tsx` — MFA-required response navigates to `/login/verify`.
- `frontend/src/features/auth/ui/MfaVerifyPage.test.tsx` (new) — valid/invalid code, backup-code toggle, no-challenge redirect.
- `frontend/src/features/settings/ui/MfaSecuritySection.test.tsx` (new) — enroll flow (QR/manual key → confirm → backup codes), disable re-auth prompt.
- `frontend/src/app/App.test.tsx`, `frontend/src/features/auth/ui/ProtectedRoute.test.tsx`, `frontend/src/features/settings/ui/AgentMemoryList.test.tsx`, `frontend/src/features/settings/ui/SettingsPage.test.tsx` — updated fixed `AuthState`/`SettingsState` preloaded-state fixtures for the new `mfaChallenge`/`mfa` fields; `SettingsPage.test.tsx` also mocks the new `authService.mfaStatusRequest` call `MfaSecuritySection` makes on mount.
- `frontend/src/services/httpClient.test.ts` — regression test locking in the interceptor exemption fix below (fails before the fix, passes after).

## Notable in-review fix

- `frontend/src/services/httpClient.ts`: the global 401-redirect interceptor (`setupAuthInterceptor`, wired to a hard `window.location.assign` in `main.tsx`) would otherwise hard-navigate away from `/login/verify` or the Settings "Security" section on any wrong-code 401 from `/api/auth/mfa/*` — before the component could render its inline error (breaking design.md D7's "inline errors" requirement, and logging a validly-authenticated Settings user out for a mistyped re-auth code). Extended the interceptor's existing `/api/auth/me` exemption to also cover `/api/auth/mfa/*`, matching the existing precedent's rationale (a credential-proof failure at these endpoints is not "your session is invalid").

## Cycle 2 (evaluation-1.md change requests)

- CR1 (misleading error message on every MFA failure path) — `MfaService.scala` fix + `MfaApiRoutesSpec.scala` regression assertions, see entries above.
- CR2 (hardcoded `#ffffff` where `--app-bg` applies) — `MfaSecuritySection.css` fix, see entry above.
- Non-blocking doc-fidelity note (design.md D6 / tasks.md 1.6 overstated `RequestValidation` normalization) — `openspec/changes/add-totp-mfa/design.md` D6 and `tasks.md` task 1.6 corrected to state what was actually built (no normalization step; malformed input is safely rejected by `TotpSupport.looksLikeTotpCode` / hashed-lookup misses). No code change.
- Non-blocking `settingsSlice.ts` file-size suggestion — deliberately NOT taken on this cycle per explicit orchestrator direction; remains a follow-up.
