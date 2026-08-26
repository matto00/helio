## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All greps/reads run against the live worktree source, not the artifacts' claims.

1. **`AuthenticatedUser` shape** — `model.scala:34`: `final case class AuthenticatedUser(id: UserId)`.
   Single field, as design says. `ApiTokenId` is at `:36` (same file, later) — fine for Scala.
2. **`AuditSource` members** — `model.scala:960-965`: `Ui | Pat | Mcp | System`, plus
   `fromString`/`asString`. CONFIRMED — no invented member needed.
3. **`AuthDirectives`** — `:28-38` `resolveApiToken` calls `repo.findUserByTokenHash(hash)` and
   returns its `Option[AuthenticatedUser]` unchanged; `:50-57` `resolveIdentity` cookie branch
   returns `userSessionRepo.findValidSession(token)` directly. Both branches are exactly the
   single chokepoints Decisions 2/3 assume. CONFIRMED.
4. **`ApiTokenRepository`** — `:42-51` `findUserByTokenHash` selects only `_.userId`;
   `:58-69` `findPrincipalByTokenHash` selects `(t.id, t.userId, t.scopedPipelineIds)`.
   The "directly reusable shape" claim is accurate. `revoke` (`:88-93`) is a plain
   `tokens.filter(...).delete`. CONFIRMED.
5. **`findUserByTokenHash` callers** — grep over `main/scala` + `test/scala`: exactly ONE
   production caller (`AuthDirectives.scala:32`) — Decision 2's claim CONFIRMED — but **two test
   fakes override it**: `test/scala/com/helio/api/http/AuthDirectivesSpec.scala:40` and
   `test/scala/com/helio/api/http/RateLimitDirectiveSpec.scala:50`.
6. **`auditService.record(...)` call sites** — grep `main/scala`: exactly **15**, one private
   `audit`/`auditSubmit` helper per file across PanelService, DataTypeService, BoundPanelService,
   AutoLayoutService, PipelineService, PipelineScheduleService, PipelineRunService, MfaService,
   DataSourceService, AuthService, DashboardContentsService, SourceService, ImageUploadService,
   ApiTokenService, DashboardService. Count CONFIRMED. (The 16th `.record(` in the tree is
   `AssertStep.scala:96 ctx.assertionSink.record(...)` — unrelated.)
7. **`AuthenticatedUser(...)` production construction sites** — grep `main/scala`: the definition
   plus `UserSessionRepository.scala:34`, `ApiTokenRepository.scala:50`, `:67`, and
   `PipelineSchedulerService.scala:107`. So exactly ONE non-repository site
   (`PipelineSchedulerService`). `DemoData.scala` contains **zero** occurrences of
   `AuthenticatedUser` (`grep -c` → `0`). 166 construction sites in `test/scala` (default params
   cover them).
8. **Does the scheduler's constructed user reach an audit call site?** YES.
   `PipelineSchedulerService.scala:107-115`: `val owner = AuthenticatedUser(pipeline.ownerId)` →
   `pipelineRunService.submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)`
   → `PipelineRunService.submit` (`:85-106`) calls `auditSubmit(pipelineId, user, isDry)` on both
   the owner and editor-grantee branches → `auditSubmit` (`:61-63`) fires
   `auditService.record(...)` whenever `!isDry` (and the scheduler always passes `isDry = false`).
9. **V91 soft reference** — `V91__audit_events.sql:84`: `actor_token_id UUID NULL,` with no
   `REFERENCES`. `grep -rn actor_token_id main/resources/db/migration/` returns that single line
   across all migrations — no later FK added. Decision 5 CONFIRMED.
10. **Auth/MFA audit helper signatures** — `AuthService.scala:88-90` and `MfaService.scala:30-32`:
    `private def audit(actorUserId: Option[UserId], action: String, metadata: JsObject = ...)`.
    Neither takes nor closes over an `AuthenticatedUser`.

### Verdict: REFUTE

The overall approach (carry provenance on `AuthenticatedUser`, extend `findUserByTokenHash`,
soft-reference already satisfied) is sound and the load-bearing facts check out. But three of the
design's explicit, load-bearing factual claims are false as of the current source, and one of them
would cause the change to silently write a *wrong* attribution — in an attribution ticket.

### Change Requests

1. **Decision 4's claim "Grep confirms no such call site currently reaches an
   `auditService.record` call" is FALSE, and the `Ui` default would mis-attribute every
   scheduler-fired run.** `PipelineSchedulerService.scala:107` constructs
   `AuthenticatedUser(pipeline.ownerId)` and passes it to `PipelineRunService.submit(..., isDry =
   false, ...)`, which calls `auditSubmit` → `auditService.record(..., AuditSource.Ui,
   "pipeline.run.submit", ...)` (`PipelineRunService.scala:61-63`, `:85-106`). Under this design
   that row would be recorded `source=ui` — a cron-fired run attributed to the browser UI, when
   `AuditSource.System` exists in the model precisely for it. Revise Decision 4 to state the real
   situation and decide explicitly: either (a) the scheduler's construction site passes
   `source = AuditSource.System` (recommended — one-line change at
   `PipelineSchedulerService.scala:107`, and it makes the `System` member non-dead), or
   (b) document with reasoning why `ui` is acceptable there. Add a corresponding task under §3 and
   a test asserting a scheduled run's audit row is not `ui`. If (a) is chosen, the spec delta
   needs a matching requirement (currently the spec only covers `ui`/`pat`/`mcp`).

2. **Decision 1's claim "Every one of the 15 `auditService.record(...)` call sites already receives
   `user: AuthenticatedUser` in scope" is FALSE for two of the 15.**
   `AuthService.scala:88` and `MfaService.scala:30` take `actorUserId: Option[UserId]` only —
   no `AuthenticatedUser` is in scope in `AuthService`'s register/login/logout/failed-login paths
   at all (identity is being established, not resolved). Task 3.1's "mechanical" edit is therefore
   not mechanical for `auth.*` events. Resolve in design, not at implementation time:
   - For `AuthService` (`auth.login`, `auth.login.failed`, `auth.login.challenged`, `auth.logout`,
     `auth.register`): state what `source` these carry and why (login inherently establishes a
     cookie session, so `Ui` is defensible — but say so, don't let it be an unexamined leftover),
     and confirm `actor_token_id` stays `None`.
   - For `MfaService`: `enable`/`disable`/`backup_codes.regenerate` (`:89`, `:99`, `:105`) DO have
     `user: AuthenticatedUser` in scope and are reachable by a PAT caller, so they should carry
     real provenance; `verifyLogin`'s `audit(Some(u.id), "auth.login")` (`:161`) and
     `:175` failed-login do not. The helper signature must change (e.g. take the source/tokenId
     explicitly) — specify that, and add it to tasks.md.

3. **Decision 2's in-place signature change breaks two test fakes that tasks.md does not mention.**
   `findUserByTokenHash` is overridden by stub repositories in
   `test/scala/com/helio/api/http/AuthDirectivesSpec.scala:40` and
   `test/scala/com/helio/api/http/RateLimitDirectiveSpec.scala:50` (the latter unrelated to this
   ticket). Both will fail to compile against
   `Option[(AuthenticatedUser, ApiTokenId)]`. Add an explicit task to update both overrides, and
   note in Decision 2 that "no second production caller" ≠ "no second caller".

4. **Remove the fabricated justification in Decision 4.** It cites "`DemoData` seeding, internal
   service-to-service construction for privileged/system paths" as the call sites the default
   params protect. `grep -c AuthenticatedUser backend/src/main/scala/com/helio/app/DemoData.scala`
   → `0`. The only real non-repository production construction site is
   `PipelineSchedulerService.scala:107` (per CR #1, which should stop being a default-params
   beneficiary anyway). The genuine beneficiary of the defaults is the ~166 `test/scala`
   construction sites — say that instead. An invented example in the one decision that also
   contains the false grep claim is the pattern worth correcting before implementation starts.

### Non-blocking notes

- `HookTriggerService` (`POST /api/hooks/run`) already resolves a token id independently via
  `TokenScope.tokenId` (`HookTriggerService.scala:79`) while its `user` will now *also* carry
  `tokenId` from `AuthDirectives`. Not a conflict (both derive from the same token hash), but a
  sentence in the design acknowledging the hooks path — currently unmentioned — would prevent a
  future reader assuming a second source of truth diverged.
- Task 5.1 ("re-grep as of the actual diff, not just design time") is exactly the right instinct
  and is why CR #1 is a design defect rather than an execution one — consider adding the same
  re-grep instruction for the `auditService.record` count.
- `AuthDirectives` cookie branch: with `source: AuditSource = AuditSource.Ui` defaulted, Decision
  3's explicit `.map(_.copy(source = Ui))` is redundant. Harmless, arguably clearer as explicit —
  no change required, but pick one and be consistent.
