## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Migration numbering (V90 vs V89):** `backend/src/main/resources/db/migration/` maxes at
  `V88__user_tier.sql`; no `V89` exists in this worktree or on `main` (`git rev-parse main` ==
  worktree `HEAD`, both `e4509016`). V90 is correctly free and the skip is explained in
  ticket.md/design.md per the dispatching session's instruction — not flagged.
- **HEL-703 tier model is real and matches the design's claims:**
  `backend/src/main/scala/com/helio/services/UserTierConfig.scala` and `ChatAccessService.scala`
  exist as described; `ChatAccessService.guard` does a fresh `userRepo.findById` per call — this
  substantiates design.md's "tier is read fresh per request, no re-login needed on the backend"
  claim.
- **`users` table has no RLS** — confirmed via `V88__user_tier.sql`'s own comment ("`users` itself
  carries NO RLS... it is the pre-identity table"). This makes D3's plan to `UPDATE users SET
  tier='beta' ... WHERE id = ? AND tier='free'` directly from the app-pool connection (inside
  `InviteCodeRepository`'s transaction) technically valid — no RLS policy blocks it.
- **`DbContext.withUserContext` already wraps `.transactionally`** (`DbContext.scala:50-51`), so
  D3's "two statements composed as one DBIO, run under `ctx.withUserContext(userId)`" is a real,
  already-atomic mechanism — not hand-waved. Confirmed against the `AssistantDailyUsageRepository`
  precedent it cites (conditional-update-returning idiom, real file, real pattern).
- **`RlsPolicyGuardSpec.rlsTables`** (`backend/src/test/scala/.../RlsPolicyGuardSpec.scala`) is a
  real allowlist test exactly as task 2.3 describes; adding `invite_codes` there is the correct,
  existing mechanism.
- **`TokenHashing.sha256Hex`** exists and is already used for `user_sessions.token_hash`
  (`UserRepository.scala:136`) — D2's hashing precedent is accurate, and Postgres's built-in
  `sha256()` (core since PG11) needs no extension, matching D2's issuance-side claim.
- **No existing email capability** — grepped `backend/src/main/scala` for
  smtp/sendgrid/mailgun/resend/javamail/password-reset: nothing found. The proposal's "first
  outbound-email capability" claim and the ticket's "check whether email already exists" directive
  are both honestly satisfied. `HttpClaudeTransport.scala` is a real, apt precedent for D6's
  `HttpResendEmailSender` (`Http(system).singleRequest` + `ConnectionPoolSettings` + never-logged
  secret header).
- **`UserResponse`/`AuthProtocol`** already carries `tier: String` (`AuthProtocol.scala:22,41`,
  `jsonFormat7`) — D7's "redeem returns the existing `UserResponse` shape" is accurate, no protocol
  redesign needed.
- **Frontend "no re-login" claim is grounded**: `ChatPage.tsx`, `QuickLauncherOverlay.tsx`,
  `ActiveConversationPanel.tsx`, and `SidebarBody.tsx` all read `currentUser?.tier` from the `auth`
  Redux slice (confirmed via grep). `authSlice.ts`'s `setAuth` reducer overwrites
  `state.auth.currentUser` synchronously — D8's plan to dispatch `setAuth({ user })` from the redeem
  thunk will genuinely re-render all four gated surfaces without reload. `frontend/src/features/
  auth/types/user.ts` already has `tier: UserTier` on `User`, so no frontend type surgery is needed
  either.
- **Frontend UI/state patterns are real precedents**: `PreferencesEditor.tsx` (TextField + explicit
  button + `InlineError`, `saveStatus`/`saveError` sub-tree pattern) and `settingsSlice.ts` (sibling
  sub-tree convention, `extractErrorMessage` pattern) are exactly what D8/task 6.2-6.3 cite.
  `SettingsPage.tsx` currently renders two sections; a third is a natural, low-risk extension.
- **In-memory cooldown precedent**: `AuthService.scala:193` already has a
  `ConcurrentHashMap[String, Long]` (CSRF state store) — D4's "best-effort in-memory 1h cooldown" is
  consistent with existing house style, not a novel risk.
- **Schema/contract precedent**: `schemas/create-api-token-request.schema.json` is a real, matching
  small-request-schema precedent for D10's `redeem-invite-code-request.schema.json`.
- **No naming collisions**: grepped for `beta-access`, `BetaAccess`, `InviteCode`, `invite_code`
  across backend/frontend/schemas — zero existing hits outside the change dir itself.
- **No placeholders**: grepped all planning artifacts for TODO/TBD/"figure out"/"not sure" — none
  found.
- **AC traceability**: all three ACs map to specific spec requirements and tasks (AC1 →
  `beta-access-request` spec + tasks 4.1/4.4/6.x; AC2 → `invite-code-redemption` +
  `settings-beta-access-ui` + `user-tier-model` specs + tasks 2.2/6.2/6.3; AC3 → "used, invalid, or
  foreign codes rejected" requirement + task 2.2/7.1). No AC is left uncovered by any task, and no
  task looks like scope drift beyond the ACs / ticket's stated scope.

### Verdict: REFUTE

Everything above checks out — this is a well-grounded, unusually specific design that correctly
reasons about atomicity, RLS, and the HEL-702 file-overlap hazard. There is exactly one concrete,
verifiable contradiction between planning artifacts that must be fixed before execution, because it
touches the load-bearing correctness mechanism for a security-relevant operation (tier upgrade).

### Change Requests

1. **`proposal.md` Impact section contradicts `design.md` D3 on how `UserRepository` is touched.**
   `proposal.md:45` states: *"Touches `UserRepository` only via the existing `updateTier`
   (minimizes HEL-702 merge overlap)."* This is incorrect and contradicts `design.md`'s D3, which
   states *"No `UserRepository` changes at all... UPDATE users SET tier='beta' WHERE id = ? AND
   tier='free' [via raw SQL] in the same `.transactionally` block [as the invite-code consumption]"*
   — explicitly **not** calling `UserRepository.updateTier`.

   This isn't just wording — it's substantively important, because `UserRepository.updateTier`
   (`UserRepository.scala:123-125`) is unconditional (`update(UserTier.asString(tier))`, no `WHERE
   tier = 'free'` guard) and runs on `UserRepository`'s own bare `db.run(...)` call, **not** inside
   `DbContext.withUserContext`'s transaction. If an implementer followed the proposal's literal
   wording and called `userRepo.updateTier(userId, Beta)` from within (or after)
   `InviteCodeRepository.redeemAndUpgrade`, it would:
   - **break atomicity** — the code-consumption UPDATE and the tier UPDATE would run on separate
     connections/transactions, so a crash between them could leave a code marked redeemed with the
     tier never upgraded, violating the `invite-code-redemption` spec's explicit "in a single
     database transaction" requirement.
   - **drop the downgrade guard** — `updateTier` has no `tier='free'` WHERE clause, reintroducing
     exactly the TOCTOU race D3 says its own guard "makes ... impossible even in a race" (an
     `owner`/`beta` downgrade under a race between the service's pre-check and the actual update).

   `tasks.md` (task 2.2: "guarded users tier update, `.transactionally`") is correctly aligned with
   `design.md` D3, not `proposal.md` — so the actual execution path is likely fine if the executor
   reads design.md/tasks.md. But `proposal.md` is a planning artifact of record and currently states
   a materially different (and less safe) mechanism than what was actually decided. **Required fix:**
   correct `proposal.md`'s Impact bullet to match D3 — e.g. "No `UserRepository.scala` changes;
   the tier update runs as raw SQL inside `InviteCodeRepository`'s own transaction (guarded, atomic
   with code consumption) — this is the file-overlap-minimizing move, not a call to the existing
   `updateTier`." This is a documentation-only fix (tasks.md needs no change), but it must be made
   before this goes into a fold-in/re-review cycle believing the artifacts agree.

### Non-blocking notes

- `beta-access/request`'s behavior when `RESEND_API_KEY`/`HELIO_EMAIL_FROM` are set but
  `HELIO_OWNER_EMAILS` is empty isn't addressed by any spec scenario (send to zero recipients? treat
  as unconfigured?). Low-probability in practice since `HELIO_OWNER_EMAILS` is already required for
  HEL-703's owner-promotion path to do anything, but worth a one-line decision in `BetaAccessService`
  when the executor gets there.
- Task 2.2 asks for a "companion Slick table" for `InviteCodeRepository` even though the actual
  redemption query is planned as raw SQL (per D3, mirroring `AssistantDailyUsageRepository`, which
  has no Slick table at all). Not wrong, just possibly unnecessary boilerplate — executor's call.
- D3/D4 don't spell out the exact success-response body shape for `POST /api/beta-access/request`
  (spec only asserts status code); trivial implementation detail, not blocking.
