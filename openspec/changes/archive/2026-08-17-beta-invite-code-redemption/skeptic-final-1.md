## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold, not trusting evaluation-1.md's narrative):**
- Read `ticket.md`, `design.md`, `files-modified.md`, `evaluation-1.md`, `tasks.md`, `skeptic-design-{1,2}.md`.
- Read `git diff main...HEAD` in full for every backend/frontend file touched (migration V90,
  `InviteCodeRepository.scala`, `BetaAccessService.scala`, `BetaAccessRoutes.scala`,
  `BetaAccessError.scala`, `EmailConfig.scala`, `HttpResendEmailSender.scala`, `ApiRoutes.scala`,
  `RequestValidation.scala`, `BetaAccessProtocol.scala`, `JsonProtocols.scala`,
  `settingsSlice.ts`, `settingsService.ts`, `BetaAccessSection.tsx`/`.css`, `SettingsPage.tsx`).
- `git diff main...HEAD -- backend/src/main/scala/com/helio/infrastructure/UserRepository.scala`
  → 0 lines. D3's file-overlap constraint held.

**Gates re-run myself, fresh (not the evaluator's pasted output):**
- `npm --prefix frontend run lint` → clean, 0 warnings.
- `npm --prefix frontend test -- --testPathPatterns="settingsSlice|BetaAccessSection|AgentMemoryList"`
  → 3 suites / 53 tests passed (includes the `setAuth` dispatch assertion on redeem success).
- `npm --prefix frontend run build` → succeeded (vite build, PWA precache generated).
- `cd backend && sbt -batch "testOnly com.helio.infrastructure.InviteCodeRepositorySpec
  com.helio.services.BetaAccessServiceSpec com.helio.api.routes.BetaAccessRoutesSpec
  com.helio.email.HttpResendEmailSenderSpec com.helio.infrastructure.RlsPolicyGuardSpec"` → 108/108
  passed, including `invite_codes` in `RlsPolicyGuardSpec`'s mechanical
  ENABLE+FORCE+"has a policy" assertions, and Flyway applying "88 - user tier" → "90 - invite codes"
  (no V89) live.
- `npm run check:schemas` → in sync (62 protocols, 46 files).
- `npm run check:scala-quality` → clean; the only soft-budget warnings are pre-existing files
  unrelated to this ticket (verified by name — none of `InviteCodeRepository.scala` (48 lines),
  `BetaAccessService.scala` (109), `BetaAccessRoutes.scala` (65), or any new test file appear).
- `npm run check:openspec` → reports "complete (21/21) but not archived" exactly as the dispatch
  note predicted (archive happens at Delivery) — not a defect.
- `git diff main...HEAD -- backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala`
  → confirmed the one-line `"invite_codes"` addition to `rlsTables`.

**AC#1 (request Beta access, owner notified by email) — traced + reproduced live:**
- `BetaAccessRoutes.scala:41-48` → `BetaAccessService.requestAccess` (`BetaAccessService.scala:37-61`)
  → tier check, `HELIO_OWNER_EMAILS` recipients, `requestBody` includes email/display name/user
  id/created-at (matches "enough info to identify and respond").
- Reproduced live: registered a fresh `free`-tier user (`hel704tester2@example.com`, seen via
  `GET /api/auth/me`), clicked "Request Beta access" → inline "Beta access requests are not
  available right now. Please try again later." — matches `BetaAccessError.EmailUnconfigured`'s
  message, confirms the designed 503 degradation (`RESEND_API_KEY` genuinely unset in this
  worktree's `backend/.env`, confirmed by grep). Console showed exactly one 503 network log entry
  for `/api/beta-access/request`, no unhandled exception.

**AC#2 (redeem valid code → tier=beta, unlocked without re-login) — independently reproduced,
not just trusted:**
- Confirmed `/chat` was gated for the free-tier user first ("Chat access is limited").
- Issued a real invite code myself via `psql ... -v email=hel704tester2@example.com -f
  backend/scripts/issue-invite-code.sql` against the isolated `helio_hel704` DB (my own
  independent SQL execution, not reusing anyone else's artifact) → got plaintext
  `c35313fee89345e4b0a6f7a3667aa3eb`.
- Set `window.__skepticMarker = 'no-reload-check'` in the live page before redeeming — a value that
  is wiped by any full page reload/navigation.
- Typed the code into Settings → Beta access → clicked "Redeem code" → section flipped in-place to
  "You have Beta access." with no full navigation.
- `window.__skepticMarker` still read `'no-reload-check'` immediately after — **proves no reload
  occurred** (stronger evidence than DOM-root inspection).
- `GET /api/auth/me` (via `page.evaluate` fetch) confirmed `tier: "beta"`.
- Clicked the "Chat" **nav link** (client-side `<Link>`, not `page.goto`) → `/chat` rendered the
  full unlocked Chat UI (composer, "New chat", etc.) instead of the gate — and the marker was
  *still* present after this navigation too, confirming the whole flow was one SPA session.
- This traces directly to `redeemInviteCodeThunk` (`settingsSlice.ts:175-186`) dispatching
  `setAuth({ user })` with the endpoint's returned `UserResponse`, and `InviteCodeRepository
  .redeemAndUpgrade` (`InviteCodeRepository.scala:29-47`) performing the code-consume + tier-upgrade
  atomically under one `.transactionally` block.

**AC#3 (used/invalid code rejected, not silently accepted) — independently reproduced:**
- Registered a second, distinct fresh user (`hel704-skeptic@example.com`).
- Attempted to redeem the now-already-used code `c35313fee89345e4b0a6f7a3667aa3eb` → inline
  "Invalid or already-used invite code", code text preserved in the field (not cleared).
- `GET /api/auth/me` for this second user confirmed `tier: "free"` unchanged — no silent
  acceptance, no partial state change.
- Traced to `InviteCodeRepository.redeemAndUpgrade`'s `WHERE ... AND redeemed_at IS NULL` guard
  returning 0 rows → `BetaAccessError.InvalidCode` → `BetaAccessRoutes`'s 400 completion — one
  indistinguishable message for unknown/foreign/already-used codes, matching the spec's "no
  validity oracle."

**Backend code-quality spot checks (not just re-trusting evaluation-1.md's assertions):**
- `InviteCodeRepository.redeemAndUpgrade`: raw-SQL conditional-update-returning idiom, single
  `.transactionally` block, `tier='free'` guard on the `users` UPDATE makes downgrade structurally
  impossible even under a race. `users` table has no RLS policy (grepped all migrations for
  `ON users` — only an index migration matched), so the cross-table UPDATE inside
  `ctx.withUserContext` is unaffected by `invite_codes`' RLS.
- `InviteCodeRepositorySpec`: 10-way concurrent redemption test asserts exactly 1 success (read in
  full, not tautological — it actually races `Future.sequence(Vector.fill(10)(...))`), plus
  foreign-code/unknown-code/no-downgrade-for-owner/no-downgrade-for-beta cases, plus RLS
  cross-user-isolation and privileged-pool-bypass cases against a real non-BYPASSRLS `SET ROLE`
  pool (not a superuser connection that would silently skip RLS).
- `EmailConfig`/`HttpResendEmailSender`: `apiKey` is placed only on the `Authorization` header,
  `EmailConfig.toString` is overridden to redact it, and the only log statements
  (`log.warn`/`log.error`) never interpolate the key or the raw exception in a way that could leak
  it (exception object passed as SLF4J's marker arg, not string-concatenated).
- Migration V90 mirrors V80 (`assistant_conversations`)'s RLS pattern exactly (ENABLE + FORCE +
  direct-owner `USING` policy, no `WITH CHECK` — matches house convention since `USING` implicitly
  covers `INSERT`/`UPDATE` when `WITH CHECK` is omitted).
- `BetaAccessSection.css`: grepped for hex/rgb literals → zero hits; every value is an
  `--app-*`/`--space-*`/`--text-*`/`--control-*`/`--weight-*` token. Compared side-by-side against
  `PreferencesEditor.css` (`.preferences-editor__section`) — identical
  padding/border/radius/background token recipe, confirming the claimed pattern reuse rather than
  a one-off.
- `InlineError`/`TextField` are genuinely the existing shared components (read both source files),
  not reimplementations.

### UI / design judgment (my domain)

Screenshots taken and inspected (not just accessibility-tree read) at 1440×900 and mobile widths,
both themes:
- Dark desktop (`settings-dark-desktop.png`) and light desktop (`settings-light.png`): the "Beta
  access" section renders as a bordered card matching the "Naming conventions" sub-card exactly —
  same border, radius, background-surface, spacing rhythm. Accent-orange buttons match "Save
  preferences"/"New dashboard" elsewhere on the page (no rogue accent shade). Disabled "Redeem
  code" (empty input) correctly shows the muted/opacity-0.6 state.
- Mobile (375px, `settings-dark.png` from the initial narrow viewport): section reflows correctly,
  no clipping/overlap, buttons remain full-width-appropriate, bottom nav unaffected.
- Light/dark parity: token-driven, both themes render coherently with no hardcoded-color leakage
  visible in either capture.
- Typography/hierarchy: "Beta access" `<h2>` matches "Preferences"/"Agent memory" sibling headings
  exactly (same weight/size), no ad hoc heading level.
- No console errors beyond the expected, already-cataloged HTTP status logs (401/503/400) during my
  own independent flow — confirmed via `browser_console_messages`, 1 error total (`503` from the
  request-access degradation), correctly surfaced inline rather than crashing.

I found no divergence from `DESIGN.md` an experienced eye would reject.

### Verdict: CONFIRM

Every AC is traced to real code and reproduced live end-to-end with independent evidence I
generated myself (a page-state marker to prove no reload, a second freshly-registered user to
prove no cross-account leakage, my own SQL invocation of the issuance script). All re-run gates are
green. `UserRepository.scala` is genuinely untouched. UI matches `DESIGN.md` and sibling Settings
sections in both themes and at mobile width. No placeholders, no scope creep, no silent AC
reinterpretation, no security leak, no downgrade path. This ships.

### Non-blocking notes

- None beyond what evaluation-1.md already flagged (the dispatch note's `-v email="'<email>'"`
  double-quoting discrepancy vs. the script's actual `-v email=<email>` usage) — confirmed myself
  when running the script directly with the unquoted form, which worked correctly.
