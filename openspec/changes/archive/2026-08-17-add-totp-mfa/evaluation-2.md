## Evaluation Report — Cycle 2 (evaluation-2.md)

Focused re-check per orchestrator direction: verify cycle 1's two change requests were resolved
(commit `181f5b3e`), re-run gates, and confirm the fixed text renders correctly live. Not a full
three-phase deep pass — unchanged areas (already PASS in evaluation-1.md) were not re-reviewed.

### CR1 — Misleading error message on every MFA failure path: RESOLVED

`backend/src/main/scala/com/helio/services/MfaService.scala` — all 8 `ServiceError.Unauthorized()`
call sites (lines 60, 85, 87, 131, 145, 150, 163, 165 in the cycle-1 diff) now share one
`private val InvalidCode: ServiceError.Unauthorized = ServiceError.Unauthorized("Invalid or expired code")`
(`MfaService.scala` companion object). Verified:

- Diff read directly: every prior bare `ServiceError.Unauthorized()` site replaced with `InvalidCode`,
  confirmed by `grep -c "ServiceError.Unauthorized()"` returning 0 in the file.
- `MfaApiRoutesSpec.scala` gained `responseAs[ErrorResponse].message shouldBe "Invalid or expired code"`
  assertions across all four failure surfaces (login verify wrong-code, login verify unknown-challenge,
  enroll-confirm wrong-code, regenerate wrong-code, disable wrong-code) — locks the fix in as a
  regression test, not just a one-off manual fix.
- **Live-reproduced the fix** (backend restarted fresh — the previously-running `sbt run` process
  predated this commit and was still serving stale bytecode; killed it and re-ran
  `start-servers.sh` to pick up the new code):
  - `/login/verify` with a wrong TOTP code → inline error now reads **"Invalid or expired code"**
    (previously "Invalid email or password").
  - Settings "Disable" prompt with a wrong re-auth code → same corrected text, MFA remains enabled.
  - Followed each negative case with a valid code to confirm the happy path (session establishment,
    single-use backup-code consumption previously verified in cycle 1) is unaffected.
- The "no oracle" design intent (uniform message across all MFA failure modes — wrong code, expired/
  unknown/attempt-capped challenge) is preserved: all 8 sites still resolve to the exact same
  `ServiceError` instance, only the string changed. Confirmed via the shared-constant structure, not
  per-site duplicated strings that could drift.

### CR2 — Hardcoded `#ffffff` where `--app-bg` applies: RESOLVED

`frontend/src/features/settings/ui/MfaSecuritySection.css:151` —
`.mfa-security-section__confirm-btn--danger`'s `color: #ffffff` replaced with `color: var(--app-bg)`,
matching the `SourceDetailPanel.css` / `TypeDetailPanel.css` precedent cited in evaluation-1.md.
Verified:

- Diff read directly: confirms the literal token swap, with an explanatory comment citing DESIGN.md's
  mechanical rule.
- **Live-confirmed via computed style** (not just visual inspection): `getComputedStyle` on the live
  "Disable" button returns `color: rgb(244, 242, 237)` — the light-theme `--app-bg` value — not a
  literal `#ffffff`, proving the token is actually wired through and resolving correctly, in the theme
  active at test time.

### Gates — fresh re-run, all green

- `cd backend && sbt test` — **3191/3191 passed** (full suite, not just the touched specs).
- `npm run lint` (frontend) — zero warnings.
- `npm run format:check` (frontend) — clean.
- `npm test` (frontend) — **1892/1892 passed**.
- `npm run check:schemas` — clean (65 protocols checked).
- `npm run check:scala-quality` — clean (only pre-existing, unrelated file-size soft-budget
  informational warnings; no new violations).

### Doc-fidelity / non-blocking items from cycle 1 — disposition confirmed

- design.md D6 and tasks.md 1.6 corrected to no longer claim `RequestValidation` normalization for MFA
  bodies — read both diffs, correction is accurate and matches what was actually built (no code change
  needed, as expected).
- `settingsSlice.ts` file-size suggestion deliberately deferred as a follow-up per explicit orchestrator
  direction — appropriately left alone this cycle, not re-flagged.

### Overall: PASS

Both cycle-1 change requests are resolved with code fixes plus locking regression tests, live-verified
rendering the corrected text/color, and all gates are green on a fresh full re-run. No new issues
introduced by this cycle's diff (`MfaService.scala`, `MfaApiRoutesSpec.scala`,
`MfaSecuritySection.css`, `design.md`, `tasks.md`, `files-modified.md`).

### Non-blocking Suggestions

(carried over from evaluation-1.md, still open, not blocking)
- `frontend/src/features/settings/state/settingsSlice.ts` remains at 440 lines, over the ~400-line
  propose-split trigger — deliberately deferred as a follow-up per orchestrator direction.
