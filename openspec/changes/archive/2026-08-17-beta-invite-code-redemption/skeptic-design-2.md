## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 required revision, re-verified fixed:**
- `proposal.md:44-47` (Impact section) now reads: "No `UserRepository.scala` changes at all: the
  tier update runs as guarded raw SQL inside `InviteCodeRepository`'s own transaction, atomic with
  code consumption (design D3) — that is the HEL-702 overlap-minimizing move, not a call to the
  existing `updateTier`." This matches `design.md` D3 verbatim in substance. Grepped the whole
  change dir for `updateTier`: the only remaining hit in `proposal.md` (line 47) is exactly this
  corrected disclaiming sentence — no residual contradiction anywhere else (capabilities, risks,
  non-goals sections all silent on the mechanism, consistent).
- Re-confirmed the underlying code facts that made this load-bearing:
  `backend/src/main/scala/com/helio/infrastructure/UserRepository.scala:123-125` —
  `updateTier` is still unconditional (`update(UserTier.asString(tier))`, no `WHERE tier='free'`
  guard) and still runs on a bare `db.run(...)`, not `DbContext.withUserContext`. D3's guarded raw
  SQL inside `InviteCodeRepository`'s own `.transactionally` block (via `DbContext.withUserContext`,
  confirmed at `DbContext.scala:44-51`) is therefore the only mechanism that satisfies the
  `invite-code-redemption` spec's atomicity and downgrade-guard requirements — and both planning
  artifacts now agree on it.

**Round-1 non-blocking notes, re-verified resolved:**
- D4 now explicitly states: "An empty/unset `HELIO_OWNER_EMAILS` (no recipients) is treated exactly
  like unconfigured email → 503 `EmailUnconfigured`." Cross-checked against
  `UserTierConfig.fromEnv()` (`backend/src/main/scala/com/helio/services/UserTierConfig.scala:24-29`):
  an unset/empty env var does produce an empty `Set[String]`, so this decision is coherent with the
  actual data D4 is branching on — not hand-waved.
- Task 2.2 now reads "no Slick table needed if raw SQL suffices, per `AssistantDailyUsageRepository`
  precedent" — no longer mandates an unnecessary companion table. Re-read
  `AssistantDailyUsageRepository.scala` in full: it is indeed a real, existing raw-SQL-only
  repository (no Slick table def) routed through `DbContext.withUserContext`, confirming the cited
  precedent is real and the revised task wording is accurate.
- D3/D4 response-body-shape gap: still open as a non-blocking implementation detail (see below) —
  correctly not escalated to a required revision.

**Fresh adversarial pass this round (not just re-litigating round 1):**
- `DbContext.withUserContext` (`DbContext.scala:44-51`) composes `setUserVar andThen action` inside
  one `.transactionally` `db.run` — confirmed this genuinely supports D3's "two statements as one
  DBIO" plan (a for-comprehension/`flatMap` conditionally issuing the `users` UPDATE only if the
  `invite_codes` UPDATE returned a row is standard Slick and not hand-waved).
- Confirmed `users` carries no RLS (`V88__user_tier.sql` migration comment, re-read) so D3's second
  statement (bare `UPDATE users ...`) running inside the same `withUserContext`-scoped transaction as
  the RLS'd `invite_codes` statement is valid — no policy blocks it, and CONTRIBUTING's "raw `db.run`
  on ACL'd tables is forbidden" rule isn't violated since `users` isn't ACL'd and the statement rides
  inside an already-`withUserContext`-scoped connection anyway.
- Concurrency: the `UPDATE invite_codes ... WHERE code_hash=? AND user_id=? AND redeemed_at IS NULL
  RETURNING id` shape is a direct copy of `AssistantDailyUsageRepository.incrementIfUnderCap`'s
  proven race-free idiom (Postgres row-lock serializes concurrent UPDATEs to the same row, second
  writer re-evaluates the WHERE and gets 0 rows) — genuinely satisfies the
  "Concurrent redemption consumes the code once" spec scenario, not just asserted.
- `ChatAccessError`/`AssistantConversationRoutes.scala` precedent for D5's "bespoke error ADT +
  completion mapping" pattern is real (grepped both; `ChatAccessError.TierForbidden`/`LimitReached`
  exist and are mapped to HTTP statuses in the routes layer) — D5's `BetaAccessError` plan is not a
  novel pattern.
- `AuthProtocol.UserResponse` (`AuthProtocol.scala:13-22`, `jsonFormat7`) already carries `tier`;
  confirmed 7 fields exactly match `jsonFormat7`'s arity. D7's "redeem returns the existing
  `UserResponse` shape, no protocol redesign" is accurate.
- Frontend: `authSlice.setAuth`/`clearAuth` (`authSlice.ts:116`, `191`) are real, already used by
  `rehydrateAuth`; `User` type (`frontend/src/features/auth/types/user.ts:15-23`) already has
  `tier: UserTier`; existing service functions (`getMeRequest`, `loginRequest`) type the raw axios
  response directly as the frontend domain type with no separate mapper — confirms D8's plan for a
  new `redeemInviteCode(code): Promise<User>` in `settingsService.ts` is a drop-in, unambiguous
  extension of an established pattern, not new architecture.
- `schemas/create-api-token-request.schema.json` re-read in full: a `code`-shaped
  `minLength`/`maxLength` string property is a direct, provable precedent for D10's planned
  `redeem-invite-code-request.schema.json` (matches D7's "≤128 chars" validation plan).
- `ApiRoutes.scala:443` confirms a real `authenticate { authenticatedUser => ... }` branch exists for
  D7's routing plan; `RequestValidation.scala` confirms the `validate*Request` naming convention task
  4.2 follows is real and consistent (10+ existing `validate...` methods, same shape).
- `JsonProtocols.scala` (`backend/src/main/scala/com/helio/api/JsonProtocols.scala`) confirms the
  "aggregator trait, per-domain trait declares its own `extends`" pattern D7/task 4.3 describes is
  real, not invented.
- `V90` numbering re-confirmed still valid this round: `ls backend/src/main/resources/db/migration/`
  still maxes at `V88__user_tier.sql`, no `V89` present — consistent with round 1's finding and the
  ticket's explicit skip-V89 instruction (standing context, not re-litigated as a new finding).
- Grepped all five planning artifacts (`proposal.md`, `design.md`, `tasks.md`, all five
  `specs/*/spec.md`, `ticket.md`) for `TODO|TBD|figure out|not sure|placeholder|XXX`: zero hits.
- AC traceability re-confirmed independently against the current spec text: AC1 →
  `beta-access-request` spec's two ADDED requirements (own email content list matches ticket's "enough
  info to identify and respond"); AC2 → `invite-code-redemption` + `settings-beta-access-ui` +
  `user-tier-model` specs (atomic-transaction requirement, immediate no-re-login requirement, downgrade
  guard); AC3 → `invite-code-redemption`'s "Used, invalid, or foreign codes are rejected" requirement
  (400, no oracle, no state change). No AC is left uncovered; no task looks like scope drift beyond
  the ticket's stated scope (issuance stays script-only per the ticket, matched by D9/task 5.1; no
  admin UI, no self-serve approval, no expiry — all correctly listed as non-goals and absent from
  tasks.md).
- No naming collisions: re-grepped for `beta-access`, `BetaAccess`, `InviteCode`, `invite_code`,
  `EmailSender`, `EmailConfig`, `com.helio.email` across `backend/src/main`, `frontend/src`,
  `schemas/` — zero hits outside the change directory.

### Verdict: CONFIRM

The one required revision from round 1 is genuinely fixed (verified against the actual `design.md`
text and the actual `UserRepository.scala`/`DbContext.scala` code it must be consistent with, not
just re-reading the correction in isolation), and all three round-1 non-blocking notes were also
addressed. This round's independent adversarial pass over the artifacts and the code they cite found
no new contradictions, no placeholders, no ambiguous tasks a competent implementer could read two
ways, and no AC left uncovered. The design is sound enough to implement.

### Non-blocking notes

- `D3`/`D4` still don't spell out the exact success-response body for `POST /api/beta-access/request`
  (spec only asserts status). Trivial (likely `{}` or a small confirmation object) — executor's call,
  not worth blocking a round-3 cycle over.
- D9's issuance script doesn't specify code entropy/length/charset for the randomly generated
  plaintext code. Low-risk for an internal, owner-only, manually-run script; reasonable to leave to
  implementation discretion (e.g. a UUID or 16+ random bytes, base32/hex-encoded) rather than
  over-specify in the design doc.
- D4 doesn't state the check ordering when multiple reject conditions could apply simultaneously
  (e.g. a non-free user within the cooldown window — 409 vs cooldown 429). Not tested by any spec
  scenario; any reasonable, consistent ordering satisfies every scenario as written.
