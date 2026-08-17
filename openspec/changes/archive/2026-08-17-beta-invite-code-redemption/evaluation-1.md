## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- AC#1 (request Beta access, owner notified by email): `POST /api/beta-access/request` implemented in
  `BetaAccessRoutes`/`BetaAccessService`; sends to all `HELIO_OWNER_EMAILS` recipients with email, display
  name, user id, created-at (`BetaAccessService.requestBody`). Verified live: a fresh `free`-tier user's
  request correctly 503s in this environment (`RESEND_API_KEY` unset by design) with a clear inline message —
  matches the documented degradation, not a bug.
- AC#2 (redeem valid code upgrades tier immediately, reflected without re-login): implemented per design D3
  (atomic `InviteCodeRepository.redeemAndUpgrade`) + D8 (`redeemInviteCodeThunk` dispatches
  `setAuth({ user })`). Verified live end-to-end: redeeming a valid code in Settings flipped the section to
  "You have Beta access." in place, and client-side navigation to `/chat` (no reload) immediately showed the
  unlocked Chat UI — the SPA was never reloaded (same DOM root/app instance throughout).
- AC#3 (used/invalid code rejected with clear error, not silently accepted): implemented — one indistinguishable
  400 "Invalid or already-used invite code" for unknown/foreign/already-used codes (design D3/D5, spec's "no
  validity oracle"). Verified live: redeeming an already-used code as a second user showed the inline error,
  left the input populated, and left `tier: "free"` unchanged (confirmed via `/api/auth/me`).
- No AC silently reinterpreted; scope matches ticket.md (manual issuance only, no admin UI, no self-serve
  approval) and proposal.md's stated non-goals.
- Tasks.md: all 21 items checked and each matches the actual diff (verified file-by-file against
  files-modified.md and `git diff`).
- No scope creep: every changed file maps to a documented capability (`invite_codes` table, email capability,
  service/routes, settings UI, ops script, schema/env docs, tests).
- No regressions: `UserRepository.scala` confirmed untouched (`git diff main...HEAD -- .../UserRepository.scala`
  is empty) — the ticket's stated HEL-702 overlap-minimizing constraint held. V90 correctly skips V89 (confirmed
  live: Flyway log shows "88 - user tier" → "90 - invite codes", no V89 present in this checkout, matching the
  documented in-flight-sibling rationale — not flagged).
- API contracts: `schemas/redeem-invite-code-request.schema.json` added and in sync with
  `BetaAccessProtocol.RedeemInviteCodeRequest` (confirmed via `npm run check:schemas` — 0 drift). CLAUDE.md env
  table and `.env.example` updated for `RESEND_API_KEY`/`HELIO_EMAIL_FROM`.
- Planning artifacts (design.md D1–D10) match the implemented behavior in every decision checked (RLS
  direct-owner pattern mirrors V80 exactly, hashed storage, atomic transaction with `tier='free'` guard,
  bespoke error ADT status mapping, route shape, frontend tier-aware section, issuance script, schema).

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run fresh by me (not trusting the executor's own report), in `WORKTREE_PATH`:

- `npm run lint` (frontend) — clean, 0 warnings.
- `npm run format:check` (frontend) — clean.
- `npm test` (frontend, full Jest suite) — 181 suites / 1903 tests passed.
- `npm --prefix frontend run build` — succeeded.
- `cd backend && sbt test` — 206 suites / 3225 tests passed, 0 failed (includes the new
  `InviteCodeRepositorySpec`, `BetaAccessServiceSpec`, `HttpResendEmailSenderSpec`, `BetaAccessRoutesSpec`, and
  the `ApiRoutesSpec`/`RlsPolicyGuardSpec` additions). Flyway applied V90 cleanly on top of V88 (V89 absent, as
  documented).
- `npm run check:schemas` — in sync, no drift.
- `npm run check:scala-quality` — clean (only pre-existing, unrelated file-size soft warnings on other files;
  none of HEL-704's own new files exceed the 250-line soft budget).
- `npm run check:openspec` — reports the change is complete-but-unarchived, exactly as expected per this
  pipeline's order (archive happens at Delivery); not a defect.

Code-quality review (CONTRIBUTING.md, DESIGN.md):

- Imports/qualifiers: no inline FQNs anywhere in the new/changed backend files (confirmed both by reading the
  diff and by `check:scala-quality`'s clean pass, which mechanically enforces this rule).
- File-size budgets: all new backend files are well under the 250-line soft budget (e.g.
  `InviteCodeRepository.scala` 48 lines, `BetaAccessService.scala` 109 lines, `BetaAccessRoutes.scala` 65
  lines); test files also under budget (`InviteCodeRepositorySpec.scala` 227, `BetaAccessRoutesSpec.scala` 234,
  `BetaAccessServiceSpec.scala` 245).
- RLS/ACL convention (CONTRIBUTING.md "Adding a new ACL'd table"): `invite_codes` gets ENABLE+FORCE RLS, a
  direct-owner policy, an index on the policy predicate, and is added to `RlsPolicyGuardSpec.rlsTables` — all
  four steps present, mirroring V80 exactly.
- `DbContext`/RLS transaction discipline: `InviteCodeRepository.redeemAndUpgrade` runs under
  `ctx.withUserContext(userId)` with `.transactionally`, never calls `db.run` directly — matches the documented
  pattern.
- Design tokens (DESIGN.md, mechanical): `BetaAccessSection.css` uses only `--app-*`/`--space-*`/`--text-*`/
  `--control-*`/`--weight-*` tokens throughout, no hardcoded colors/spacing; reuses the shared `TextField` and
  `InlineError` components and mirrors `PreferencesEditor.css`'s established section/button recipe exactly —
  no new one-off patterns introduced.
- DRY: redeem's response reuses the existing `UserResponse`/`AuthProtocol` shape rather than inventing a new
  DTO (per design D7); `TokenHashing.sha256Hex` reused rather than reimplemented; `HttpResendEmailSender`
  explicitly mirrors `HttpClaudeTransport`'s connection-settings pattern rather than duplicating divergent
  Pekko HTTP client setup.
- Type safety: no `any`/untyped escape hatches on the frontend; the bespoke `BetaAccessError` ADT gives
  exhaustive, typed error-to-status mapping on the backend (`completeBetaAccessError` matches all 5 cases).
- Security: code stored only as sha256 hash (plaintext never persisted); RLS restricts app-context reads to
  the intended recipient; API key never logged (`EmailConfig.toString` redacts it, and `HttpResendEmailSender`
  never interpolates it anywhere but the `Authorization` header) — matches the owner-notification-email spec's
  "never appears in logs" requirement, and is exercised by `HttpResendEmailSenderSpec`.
- Error handling: no silent failures — every failure path (unconfigured email, cooldown, send failure,
  ineligible tier, invalid code) maps to an explicit status + inline UI message; race-free single-use
  redemption is verified in `InviteCodeRepositorySpec`'s 10-way concurrent-redemption test (exactly 1 success).
- Tests meaningful: repository/service/route specs cover every spec scenario (concurrent redemption, foreign
  code, already-used code, owner/beta never-downgraded, RLS isolation, cooldown, send failure, 401 coverage);
  frontend tests assert the `setAuth` dispatch on redeem success and per-tier rendering — these would catch a
  real regression in any of the paths they cover.
- No dead code: no leftover TODO/FIXME, no unused imports (lint's zero-warnings pass confirms this on the
  frontend; `check:scala-quality` + a successful `sbt test` compile confirms no unused/broken imports on the
  backend).
- No over-engineering: `InviteCodeRepository` uses raw SQL (no new Slick table mapping) per the
  `AssistantDailyUsageRepository` precedent the design cites; no premature abstraction (e.g. no generic
  "provider-agnostic" email abstraction beyond the one trait needed).
- `AgentMemoryList.test.tsx` change is a mechanical, well-justified fixture update (widened `SettingsState`
  shape) with an explicit comment — not scope creep.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via the canonical script and asserted healthy (`start-servers.sh` / `assert-phase.sh` both
returned READY/PASS). Verified live against the worktree's isolated `helio_hel704` DB (fresh, no seeded users)
using two newly-registered accounts:

- Happy path end-to-end: registered a free-tier user → Settings shows "Beta access" section with request +
  redeem controls → clicked "Request Beta access" → got the designed 503 inline degradation (email
  unconfigured in this environment, as documented) → issued a code via `backend/scripts/issue-invite-code.sql`
  as the dev superuser → redeemed it in Settings → section switched in-place to "You have Beta access." →
  navigated (client-side, no reload) to `/chat` → chat surface was immediately unlocked, proving AC#2's core
  claim (no re-login/reload needed) with the same app instance/DOM root throughout.
- Unhappy paths: reused the now-consumed code as a second free-tier user → clear inline "Invalid or
  already-used invite code" error, code preserved in the field, `tier` confirmed still `free` via
  `/api/auth/me` — no silent acceptance, no blank screen, no unhandled exception.
- Loading/empty/error states: request button shows "Requesting…"/disabled while in flight; redeem button
  disabled while empty or in flight; `InlineError` used for both inline error surfaces, matching the shared
  component convention.
- Console: no genuine runtime errors/exceptions on this ticket's code paths — the only console entries on
  port 6136 were the expected HTTP error responses (401 pre-login, 503 unconfigured-request, 400
  invalid-code, and one pre-existing unrelated 403 on `/api/auth/logout` used only for test setup, not part of
  this ticket), all handled gracefully by the UI.
- Entry points: the single documented entry point (Settings page, third section) works; tier-aware rendering
  confirmed for `free` (controls shown) and `beta` (confirmation-only, controls hidden) via both live testing
  and `BetaAccessSection.test.tsx`'s owner-tier case.
- Accessible names/keyboard: "Request Beta access"/"Redeem code" are real `<button>` elements with visible
  text names; the code field carries `aria-label="Invite code"` and is inside a real `<form>` with a submit
  button, giving standard keyboard/Enter support.
- Breakpoints: resized to 1440/1100/768/375 (0 → smallest supported mobile width) — Beta access section
  reflows correctly at every width (row layout down to ~768, wraps gracefully at 375 via existing
  `flex-wrap: wrap`), no overlap or clipping, mobile bottom-nav unaffected.

Note (non-blocking, environment-only): the dispatching context's suggested psql invocation
(`-v email="'<user email>'"`, with the email wrapped in extra single-quotes) fails against
`issue-invite-code.sql`'s actual `:'email'` substitution; the script's own header-documented usage
(`-v email=requester@example.com`, unquoted) works correctly. This is a discrepancy in the dispatch note, not
a defect in the delivered script — no change requested.

### Overall: PASS

### Non-blocking Suggestions
- None beyond the dispatch-note discrepancy already called out above (informational only, not an executor
  defect).
