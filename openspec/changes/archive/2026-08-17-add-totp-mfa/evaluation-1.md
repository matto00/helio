## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  1. Enroll from Settings (QR + manual key + real-code confirm) — implemented (`MfaEnrollModal.tsx`) and
     live-verified end-to-end: enrolled with a real RFC 6238 code computed from the returned secret,
     backup codes displayed exactly once.
  2. Both password and Google-OAuth login paths require TOTP/backup code once enabled —
     `AuthService.finishLogin`/`LoginOutcome` gate wired identically into `AuthRoutes`/`OAuthRoutes`
     (`google-oauth-login`/`email-password-auth` deltas). Live-verified for the password path
     (OAuth path not live-tested — no OAuth test credentials in this environment — but code is
     structurally identical per the diff and is covered by `GoogleOAuthRoutesSpec`'s new MFA case).
  3. Backup codes single-use — live-verified: consuming a saved backup code at login dropped
     "backup codes remaining" from 10 to 9 in Settings, and the flow is covered by
     `MfaApiRoutesSpec`'s "used backup code rejected" case.
  4. Disable with re-authentication — live-verified: wrong code left MFA enabled with an inline
     error, correct code disabled it and returned to the un-enrolled state.
- [x] No AC silently reinterpreted.
- [x] All task items in `tasks.md` (39/39) marked done and match what was implemented, with one
  documentation-fidelity gap noted below (non-blocking).
- [x] No unnecessary changes outside ticket scope. The `httpClient.ts` interceptor-exemption fix
  (extending the existing `/api/auth/me` 401 exemption to `/api/auth/mfa/*`) is in-scope: without it,
  a wrong MFA code would hard-redirect the user to `/login` before the inline error could render,
  which is a real regression against design.md D7's "inline errors" requirement — correctly caught
  and fixed in-review per `files-modified.md`'s own "Notable in-review fix" section.
- [x] No regressions to existing behavior: full backend (3191 tests) and frontend (1892 tests) suites
  pass; accounts without MFA enabled are unaffected on both login paths (verified structurally via
  `finishLogin`'s `case None => mintSession(user)` fallback plus the defaulted `mfaService: Option[MfaService] = None`
  keeping ~9 existing `AuthService` construction sites untouched).
- [x] API contracts/schemas updated in the same change: `schemas/mfa-{enroll-response,required-response,status-response,verify-request}.schema.json`
  added; `npm run check:schemas` passes (65 protocols checked, MFA included).
- [~] Planning artifacts mostly reflect final implemented behavior, with one gap: design.md D6 states
  "request normalization in `RequestValidation` per house pattern" and task 1.6 claims "validation via
  `RequestValidation`," but `backend/src/main/scala/com/helio/api/RequestValidation.scala` has zero
  MFA-related entries — `MfaConfirmRequest`/`MfaReauthRequest`/`MfaVerifyRequest` bodies flow straight
  into `MfaService` with no normalization step. This has no observed functional/security impact
  (malformed codes are safely rejected by `TotpSupport.looksLikeTotpCode` / hashed-lookup misses), so
  it is a documentation-vs-implementation drift, not an AC gap — non-blocking, noted for the design doc
  to be corrected or the omission justified.

### Phase 2: Code Review — FAIL

Gates (all re-run fresh in `WORKTREE_PATH`, not trusted from the executor's report):
- `cd backend && sbt test` — **3191/3191 passed**, migration V89 applied cleanly on top of 88 (V88 is a
  deliberate gap per dispatch), `RlsPolicyGuardSpec` unaffected (MFA tables correctly excluded from the
  RLS allowlist — pre-identity tables, matching the `users`/`user_sessions` precedent).
- `npm run lint` (frontend) — clean, zero warnings.
- `npm run format:check` (frontend) — clean.
- `npm test` (frontend) — **1892/1892 passed**.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size warning, unrelated to
  this change).
- `npm run check:schemas` — clean.
- `npm run check:scala-quality` — clean (no inline-FQN violations; only pre-existing, codebase-wide
  file-size soft-budget warnings, none introduced by this change crossing the 400-line propose-split
  trigger).

Issues:

1. **Misleading error message on every MFA failure path** (Readable/correctness,
   `backend/src/main/scala/com/helio/services/MfaService.scala:60,85,87,131,145,150,163,165`). All
   eight `ServiceError.Unauthorized()` call sites in `MfaService` use the zero-arg default, whose
   message is `"Invalid email or password"` (`backend/src/main/scala/com/helio/services/ServiceError.scala:20`
   — a string written for the password-login case and reused here unintentionally, not by
   design). This message is sent verbatim in the response body's `message` field
   (`ServiceResponse.scala:69`) and surfaced directly by the frontend
   (`frontend/src/features/auth/state/authSlice.ts`'s `verifyMfa` thunk reads
   `err.response?.data?.message` before falling back to its own better-fitting
   `"Invalid code. Please try again."`). **Live-reproduced twice**: submitting a wrong TOTP code on
   `/login/verify` displayed "Invalid email or password" (no password was ever part of that request),
   and submitting a wrong re-auth code on the Settings "Disable" prompt showed the identical text. The
   same code path backs enroll-confirm and regenerate re-auth, so all four MFA failure surfaces are
   affected. This is not a security issue (the generic-401 "no oracle" design intent is preserved) but
   is a real, demonstrably wrong content defect that will confuse users of a security feature they just
   set up. Fix: give each `MfaService` failure site (or a shared helper) an MFA-appropriate message,
   e.g. `ServiceError.Unauthorized("Invalid or expired code")`.

2. **Hardcoded color where an existing token applies** (DESIGN.md [mechanical],
   `frontend/src/features/settings/ui/MfaSecuritySection.css:151`). `.mfa-security-section__confirm-btn--danger`
   sets `color: #ffffff` on an `--app-error` background. DESIGN.md line 91 is explicit: "**[mechanical]**
   No hardcoded hex/rgb/rgba in component CSS or TSX where a token applies." The exact same "danger
   confirm button" pattern already exists twice in this codebase and both reuse a token instead:
   `frontend/src/features/sources/ui/SourceDetailPanel.css:100-103`
   (`.source-detail-panel__delete-confirm-btn { background: var(--app-error); color: var(--app-bg); }`)
   and `frontend/src/features/dataTypes/ui/TypeDetailPanel.css:108-111` (identical). Fix: replace
   `color: #ffffff` with `color: var(--app-bg)` to match the established precedent. (The QR-code
   `background: #ffffff` in `MfaEnrollModal.css:40` is NOT flagged — it is explicitly documented inline
   as a fixed-contrast data requirement for scannability, the same documented-exception class DESIGN.md
   §"Documented exception" already carves out for accent preset swatches/chart palettes; no themed token
   could satisfy "always white regardless of theme" here.)

- [x] DRY — `MfaBackupCodesList` is correctly shared between the enroll and regenerate flows;
  `AuthResult.of` duplicates (byte-identical, per its own doc comment) rather than reuses
  `AuthService.authResultOf` — justified and documented as the deliberate resolution of a one-directional
  dependency (`MfaService` depends on `AuthService`'s companion object, never the reverse), not an
  oversight.
- [x] Type safety — sealed `LoginOutcome`, no `any`/unchecked casts spotted in the diff.
- [x] Security — replay guard (`last_used_step`, compare-and-set), hashed secrets/tokens/backup codes
  (`TokenHashing.sha256Hex`), attempt cap + TTL on login challenges, single-use backup-code consumption,
  `HttpOnly` cookie only set post-verification, no user object leaked pre-second-factor — all
  live-verified working as designed.
- [x] Tests meaningful — `TotpSupportSpec` exercises real RFC 6238 Appendix B vectors plus an
  independently-computed round-trip helper (not a tautology); `MfaServiceSpec`/`MfaApiRoutesSpec` cover
  the attempt cap, TTL, single-use, and 409/401 paths.
- [x] No dead code, no over-engineering, behavior-preserving refactor discipline — `AuthService`/
  `OAuthRoutes`/`AuthRoutes` hunks are the exact minimal one-call-site swaps design.md D3 specifies,
  correctly isolating the HEL-703 merge-conflict surface.

### Phase 3: UI Review — PASS (with the Phase 2 issue #1 also observable here)

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both PASS.

- [x] Happy path end-to-end, live-tested with real computed TOTP codes (RFC 6238 HMAC-SHA1, Python):
  register → Settings → enroll (QR + manual key) → confirm with a real code → 10 backup codes shown
  once → sign out → sign in → gated to `/login/verify` (no cookie set, confirmed via
  `document.cookie` empty due to `HttpOnly`) → verify with a real TOTP code → session established,
  landed on `/`. Also tested the backup-code branch of `/login/verify` end-to-end (single-use consumption
  confirmed via the remaining-count dropping 10→9 in Settings) and the disable-with-re-auth flow.
- [x] Unhappy paths handled gracefully: wrong TOTP code on `/login/verify` stays on the page with an
  inline error (no blank screen, no hard redirect — confirms the `httpClient.ts` interceptor fix works);
  wrong re-auth code on the Settings disable prompt leaves MFA enabled with an inline error. (Content of
  that error is wrong — see Phase 2 issue #1 — but the *handling* itself is correct: no crash, no
  silent failure, no unwanted navigation.)
- [x] Loading states present (`"Generating your secret…"`, `"Verifying…"`, `"Confirming…"`,
  `"Regenerating…"`, `"Disabling…"`); errors rendered via the shared `InlineError` component throughout.
- [x] No console errors during any tested flow beyond expected network-level 401 log lines for
  intentionally-wrong-code submissions and the pre-existing `/api/auth/me` rehydration pattern (same
  class of benign browser network logging already present pre-ticket).
- [x] Feature works from both entry points structurally verified in code (password-login path
  live-tested; OAuth callback path not live-tested — no OAuth test credentials available in this
  environment — but `OAuthCallbackPage.tsx`'s branch is structurally identical to `LoginPage.tsx`'s and
  covered by `OAuthCallbackPage.test.tsx` + `GoogleOAuthRoutesSpec`'s new MFA case).
- [x] Interactive elements have accessible names (`"Authentication code"`, `"Backup code"`, `"Manual
  entry key"`, `"Copy manual entry key"`, `"Re-authentication code"` all have proper labels/aria-labels)
  and keyboard/focus behavior is correct (the enroll modal correctly traps pointer events on the
  backdrop while open — confirmed via a blocked click attempt outside the dialog).
- [x] Breakpoints 1440 / 1100 / 768 / 375 all render `/login/verify` and the Settings enroll modal
  cleanly with no layout breakage, consistent with the existing auth-card pattern; light/dark theme
  parity confirmed for the Security section status badge and the enroll modal (screenshots taken at
  both themes).

### Overall: FAIL

### Change Requests

1. `backend/src/main/scala/com/helio/services/MfaService.scala:60,85,87,131,145,150,163,165` — replace
   the bare `ServiceError.Unauthorized()` (which inherits `ServiceError.scala:20`'s
   `"Invalid email or password"` default, written for the password-login case) with an MFA-appropriate
   message, e.g. `ServiceError.Unauthorized("Invalid or expired code")`, at every MFA failure site
   (login verify, enroll confirm, regenerate/disable re-auth). Live-reproduced showing this exact
   incorrect text on both `/login/verify` and the Settings disable prompt.
2. `frontend/src/features/settings/ui/MfaSecuritySection.css:151` — change
   `.mfa-security-section__confirm-btn--danger`'s `color: #ffffff` to `color: var(--app-bg)`, matching
   the existing "danger confirm button" token pattern already established in
   `frontend/src/features/sources/ui/SourceDetailPanel.css:100-103` and
   `frontend/src/features/dataTypes/ui/TypeDetailPanel.css:108-111` (DESIGN.md's [mechanical]
   no-hardcoded-hex-where-a-token-applies rule).

### Non-blocking Suggestions

- `frontend/src/features/settings/state/settingsSlice.ts` grew from 218 to 440 lines (+226 for MFA
  state/thunks), crossing CONTRIBUTING.md's "if a file crosses ~400 lines, propose a split in the PR
  description" trigger without a split proposal in `design.md`/`files-modified.md`. Consider factoring
  the MFA sub-tree into its own slice module (or at least flagging the split in a follow-up) rather than
  growing this file further next time it's touched.
- design.md D6's "request normalization in `RequestValidation` per house pattern" was not actually
  implemented (no MFA entries in `RequestValidation.scala`) — no functional impact observed, but either
  add the normalization step or correct the design doc so it doesn't overstate what was built.
