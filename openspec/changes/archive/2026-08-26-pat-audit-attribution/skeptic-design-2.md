## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-verification of the revised design/tasks/spec against the live codebase.
Every claim below was checked against source, not against the artifacts' prose.

### What I verified (with evidence)

**CR1 (scheduler misattribution) — fixed and grounded.**
- `PipelineSchedulerService.scala:107` is exactly `val owner = AuthenticatedUser(pipeline.ownerId)`
  (grep by literal, line number matches Decision 6 / task 3.4).
- It calls `pipelineRunService.submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)`.
- `PipelineRunService.scala:61-62`: `private def auditSubmit(pipelineId, user, isDry)` guarded by
  `if (auditService != null && !isDry)`; called at `:99` and `:105` on the submit path. With
  `isDry = false` the audit row IS written, so the `source=System` requirement is load-bearing, not
  theoretical. Decision 6 and the new spec requirement are correct.

**CR2 (AuthService/MfaService take Option[UserId]) — fixed and line-accurate.**
- `AuthService.scala:88` — `private def audit(actorUserId: Option[UserId], action: String, metadata: JsObject = JsObject.empty)`.
  `grep -n "AuthenticatedUser" AuthService.scala` returns **zero** matches — the claim "no
  `AuthenticatedUser` ever reaches it" is true of the whole file, not just the helper. Its five call
  sites (`:119 auth.register`, `:162 auth.login.failed`, `:169 auth.login`, `:170 auth.login.challenged`,
  `:180 auth.logout`) are all session-login-path. Decision 5 / task 3.2 correct.
- `MfaService.scala:30` — same `Option[UserId]` helper. Its `audit(` call sites are at exactly
  `:89` (`auth.mfa.enable`), `:99` (`auth.mfa.backup_codes.regenerate`), `:105` (`auth.mfa.disable`),
  `:161` (`auth.login` in `establishSession`), `:175` (`auth.login.failed` in `recordFailedAttempt`)
  — all five line numbers in Decision 5 / task 3.3 match the live file exactly.
- Confirmed the first three do have `user: AuthenticatedUser` as a method parameter
  (`confirmEnrollment(req, user)`, `regenerateBackupCodes(req, user)`, `disable(req, user)`), and the
  last two are private helpers taking only `(challengeToken: String, userId: UserId)` — no request
  credential in scope, so the `Ui`/`None` default is the right call there.

**CR3 (test fakes) — both real, both actually override the method.**
- `grep -rn findUserByTokenHash backend/src` → exactly one production caller
  (`AuthDirectives.scala:32`) and exactly two test overrides:
  `AuthDirectivesSpec.scala:40` and `RateLimitDirectiveSpec.scala:50`, both literally
  `override def findUserByTokenHash(hash: String): Future[Option[AuthenticatedUser]]` inside an
  anonymous `new ApiTokenRepository(null)` subclass. Task 2.4 names them correctly.

**CR4 (fabricated DemoData justification) — removed; replacement claim is true.**
- `grep -c "AuthenticatedUser(" backend/src/test/scala` = **166** — Decision 4's "~166 test-fixture
  call sites" is accurate, not a guess.
- Verified the default-param approach is actually safe: no `jsonFormatN(AuthenticatedUser...)`,
  no `case AuthenticatedUser(...)` destructuring, no `.unapply`/`.apply` references anywhere in the
  tree, so adding two defaulted fields to the case class cannot break arity/format wiring.
  `AuthDirectivesSpec` asserts only on `.id.value` (`:76`, `:89`, `:104`), not on whole-value
  equality, so a PAT resolution now carrying `source=Pat` will not silently fail those.

**Independent checks the revision did not claim:**
- The "15 call sites / 13 with `user` in scope" arithmetic holds: `grep -rn "auditService.record("`
  over `main/scala` returns exactly 15 non-definition hits; 13 pass `Some(user.id)` and the 2
  outliers are precisely `AuthService.scala:90` and `MfaService.scala:32` (both `actorUserId`).
  Decision 1's split is exact.
- Production `AuthenticatedUser(...)` construction sites are exactly 4: `UserSessionRepository:34`,
  `ApiTokenRepository:50` and `:67`, `PipelineSchedulerService:107`. All are either the two
  resolution paths Decision 3 covers or the scheduler Decision 6 covers — nothing else needs a
  non-default source, confirming task 5.1's premise.
- Decision 7 verified: `V91__audit_events.sql:84` is `actor_token_id UUID NULL` with an explicit
  comment at `:66` "Deliberately a SOFT reference — no REFERENCES clause"; `ApiTokenRepository.revoke`
  (`:88`) is a plain filtered `.delete` with no cascade. The soft-reference AC is already satisfied
  and the ticket correctly only adds a test.
- `AuditSource` (`model.scala:960-973`) really does define `Ui | Pat | Mcp | System` with
  `fromString`/`asString` mappings for all four — `System` is wireable today, no model change needed.
- `AuditService.record` (`:29-37`) already takes `actorTokenId: Option[ApiTokenId]` and
  `source: AuditSource` positionally — no service-signature change needed, as the design states.
- `AuthDirectives.resolveApiToken` (`:28-37`) is the sole consumer of `findUserByTokenHash` and
  already has the hash in hand, so Decision 2's in-place reshape is mechanically straightforward.

Ticket ACs each trace to a planned artifact: AC1→spec req 1 + task 4.1/4.2; AC2→spec req 2 +
task 2.1/2.2/4.2; AC3→spec req 5 + task 4.3; AC4→tasks 4.1-4.6.

### Verdict: CONFIRM

All four round-1 change requests are genuinely resolved against ground truth, and the four
specific claims I was asked to re-check (MfaService line numbers, AuthService's helper,
the scheduler/auditSubmit path, the two test fakes) are each literally true of the live files.
The design is implementable as written.

### Non-blocking notes

- `ApiTokenRepository.scala:54-56`'s scaladoc on `findPrincipalByTokenHash` describes
  `findUserByTokenHash` as "(unchanged, left for every existing caller)". Task 2.1 makes that
  comment stale; the executor should refresh it when reshaping the method.
- `HookTriggerService`-driven runs will now record `pipeline.run.submit` with `source=pat` and the
  hook token's id via `PipelineRunService:63` — correct, but untested by any task. Worth a cheap
  assertion if convenient; not required by any AC.
- design.md presents Decision 5 before Decision 4; purely cosmetic ordering.
