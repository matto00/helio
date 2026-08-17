# Tasks: add-totp-mfa (HEL-702)

## 1. Backend

- [x] 1.1 Add deps to `backend/build.sbt`: `com.eatthepath % java-otp % 0.4.0`, `commons-codec % commons-codec` (design.md D1)
- [x] 1.2 Add migration `V89__totp_mfa.sql` (NOT V88 — claimed by HEL-703; design.md D2): `user_mfa`, `mfa_backup_codes`, `mfa_login_challenges`, no RLS, header comment citing HEL-702 + the V88 gap reason
- [x] 1.3 Domain: `UserMfa`, `MfaLoginChallenge` case classes in `com.helio.domain`; sealed `LoginOutcome` (`SessionEstablished`/`MfaRequired`) in `com.helio.services`
- [x] 1.4 New `MfaRepository` (raw Slick `Database`, like `UserRepository`): CRUD for the three tables — upsert/find/enable/delete `user_mfa`, `last_used_step` compare-and-set, backup-code insert/consume/count/deleteAll, challenge create/find-by-hash/increment-attempts/delete
- [x] 1.5 New `TotpSupport` (infrastructure): secret generation (20 bytes `SecureRandom` → commons-codec Base32), otpauth URI builder, ±1-step verify loop over `java-otp` with `last_used_step` replay guard (design.md D5)
- [x] 1.6 New `MfaService`: status / startEnrollment (409 if enabled) / confirmEnrollment (enable + 10 backup codes) / regenerateBackupCodes / disable / createLoginChallenge / verifyLogin (TOTP-or-backup dispatch, attempt cap 5, TTL 5 min, uniform `"Invalid or expired code"` message — evaluation-1.md CR1) — no `RequestValidation` normalization step needed (codes/tokens need no string-shape normalization; malformed input is safely rejected by `TotpSupport.looksLikeTotpCode` / hashed-lookup misses — design.md D6 correction, evaluation-1.md non-blocking note)
- [x] 1.7 `AuthService`: add `mfaService: Option[MfaService] = None` ctor param (defaulted — test call sites untouched, design.md D3); replace login success branch (lines 84-88) with single `finishLogin(user)` call; `completeOAuth` returns `Future[LoginOutcome]` via `finishLogin`; add private `finishLogin` at file bottom
- [x] 1.8 Protocols: new `MfaProtocol` (status/enroll/confirm/regenerate/disable/verify request+response formats, `MfaRequiredResponse(mfaRequired, challengeToken)`) mixed into `JsonProtocols`
- [x] 1.9 `AuthRoutes` login + `OAuthRoutes` callback: branch on `LoginOutcome` — `SessionEstablished` → `setCookie` as today; `MfaRequired` → 200 `{mfaRequired, challengeToken}`, no cookie, no user (keep hunks minimal per design.md D3)
- [x] 1.10 New `MfaRoutes`: authenticated (`GET /api/auth/mfa`, `POST enroll|enroll/confirm|backup-codes/regenerate|disable`) mounted in the `authenticate` concat; public `POST /api/auth/mfa/verify` (challenge → session via `ServiceResponse.runWith`) mounted in the public `pathPrefix("auth")` concat (`ApiRoutes.scala:426`); wire `MfaService` in `ApiRoutes`

## 2. Schemas

- [x] 2.1 New `schemas/mfa-enroll-response.schema.json`, `mfa-verify-request.schema.json`, `mfa-status-response.schema.json`, `mfa-required-response.schema.json` (2020-12, per api-token precedent)

## 3. Frontend

- [x] 3.1 Add `qrcode.react` to `frontend/package.json` (design.md D1)
- [x] 3.2 `authService.ts`: `mfaStatusRequest`, `mfaEnrollRequest`, `mfaConfirmRequest`, `mfaRegenerateRequest`, `mfaDisableRequest`, `mfaVerifyRequest`; login/OAuth response types become `AuthResponse | MfaRequiredResponse` union
- [x] 3.3 `authSlice.ts`: `mfaChallenge` transient field + `verifyMfa` thunk; `login`/`handleOAuthCallback` fulfilled reducers branch on `mfaRequired` (status stays `"unauthenticated"`, challenge stored); cleared on verify success/logout/`clearAuth` (design.md D7)
- [x] 3.4 `LoginPage.tsx`: `mfaRequired` fulfillment → `navigate("/login/verify")`; `OAuthCallbackPage.tsx`: same branch (no `setAuth` dispatch)
- [x] 3.5 New `MfaVerifyPage.tsx` at public route `/login/verify` (App.tsx): code entry + backup-code toggle → `verifyMfa`; success → `/`; no challenge in state → redirect `/login`; inline errors per DESIGN.md
- [x] 3.6 New `MfaSecuritySection.tsx` + section in `SettingsPage.tsx`: status view, enroll modal (QR via `qrcode.react` + copyable manual key → confirm code → one-time backup codes with copy), regenerate + disable prompts (re-auth code); state/service per settings feature layout
- [x] 3.7 CSS for the new components using DESIGN.md tokens (no hardcoded colors/spacing)

## 4. Tests

- [x] 4.1 `TotpSupportSpec`: RFC 6238 Appendix B vectors; ±1-step window; replay rejection via `last_used_step`; Base32/otpauth URI shape
- [x] 4.2 `MfaServiceSpec`: enrollment lifecycle (start/replace-unconfirmed/409-when-enabled/confirm), backup-code single-use + regeneration, challenge TTL + attempt cap + generic errors, disable re-auth
- [x] 4.3 New `MfaApiRoutesSpec` (not a further-grown `ApiRoutesSpec.scala`, already ~3900+ lines over budget — mirrors `GoogleOAuthRoutesSpec`'s own precedent of an independent, focused route-spec file): MFA-off login unchanged; MFA-on login → 200 `{mfaRequired, challengeToken}` no cookie no user; verify (TOTP + backup) → cookie + `{expiresAt, user}`; used backup code rejected; wrong code increments attempts; expired/capped challenge → 401; enroll/confirm/status/regenerate/disable routes incl. 401/409 paths
- [x] 4.4 `GoogleOAuthRoutesSpec`: existing specs compile untouched (defaulted ctor param); add MFA-enabled callback case → `{mfaRequired, challengeToken}`, no `Set-Cookie`
- [x] 4.5 `authSlice.test.ts`: `mfaRequired` fulfillment stores challenge + stays unauthenticated; `verifyMfa` success authenticates + clears challenge; failure path
- [x] 4.6 `LoginPage.test.tsx` + `OAuthCallbackPage.test.tsx`: MFA branch navigates to `/login/verify`; new `MfaVerifyPage.test.tsx`: valid/invalid code, backup toggle, no-challenge redirect
- [x] 4.7 New `MfaSecuritySection.test.tsx`: enroll flow renders QR + manual key, confirm enables, backup codes shown once, disable re-auth prompt
- [x] 4.8 Run full gates: backend `sbt test`, frontend `npm test`, `npm run lint`, `npm run format:check`
