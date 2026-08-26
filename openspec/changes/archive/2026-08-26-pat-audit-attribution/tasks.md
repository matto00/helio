## 1. Domain model

- [x] 1.1 Extend `AuthenticatedUser` with `source: AuditSource = AuditSource.Ui` and
      `tokenId: Option[ApiTokenId] = None` (model.scala).

## 2. Token resolution

- [x] 2.1 Extend `ApiTokenRepository.findUserByTokenHash` to also select the token's `id`,
      returning `Option[(AuthenticatedUser, ApiTokenId)]` (mirroring `findPrincipalByTokenHash`'s
      query shape).
- [x] 2.2 Update `AuthDirectives.resolveApiToken` to map that result into an `AuthenticatedUser`
      with `source=AuditSource.Pat` and `tokenId=Some(the resolved id)`.
- [x] 2.3 Update `AuthDirectives.resolveIdentity`'s cookie branch to set `source=AuditSource.Ui`
      (and leave `tokenId=None`) on the resolved `AuthenticatedUser`.
- [x] 2.4 Update the two test fakes that override `findUserByTokenHash` to the new return shape:
      `test/scala/com/helio/api/http/AuthDirectivesSpec.scala:40` and
      `test/scala/com/helio/api/http/RateLimitDirectiveSpec.scala:50` (design.md Decision 2 /
      skeptic design-1 CR3).

## 3. Call-site wiring

- [x] 3.1 Update the 13 `auditService.record(...)` call sites that already have
      `user: AuthenticatedUser` in scope (dashboards, panels, pipeline/pipeline-step/pipeline-run,
      pipeline schedule, data sources, data types, sources, image upload, API tokens — per
      HEL-477's `route-audit-enumeration.md`, excluding `AuthService`/`MfaService`) to pass
      `user.tokenId`/`user.source` instead of the hardcoded `None`/`AuditSource.Ui`. Re-grep the
      call-site list against the current diff before starting — do not trust the count above as a
      checklist without re-verifying it (design.md task 5.1 / skeptic design-1 non-blocking note).
- [x] 3.2 `AuthService`'s `audit(actorUserId: Option[UserId], ...)` helper: leave the signature
      unchanged (design.md Decision 5) — no `AuthenticatedUser` reaches it; confirm every call site
      still passes `source=Ui`/`tokenId=None` implicitly via `AuditService.record`'s own defaults
      or explicit `AuditSource.Ui`/`None` args (whichever the current call shape uses).
- [x] 3.3 `MfaService`'s `audit(...)` helper: add `source: AuditSource = AuditSource.Ui,
      tokenId: Option[ApiTokenId] = None` parameters. Update `confirmEnrollment` (`:89`),
      `regenerateBackupCodes` (`:99`), and `disable` (`:105`) to pass `user.source`/`user.tokenId`
      (the `AuthenticatedUser` already in scope at those three call sites). Leave
      `establishSession`/`recordFailedAttempt`'s calls (`:161`, `:175`) at the `Ui`/`None` default
      — no request credential is resolved at that point (design.md Decision 5).
- [x] 3.4 `PipelineSchedulerService.scala:107`: construct the owner `AuthenticatedUser` with
      `source = AuditSource.System, tokenId = None` explicitly, not the default (design.md
      Decision 6).

## 4. Tests

- [x] 4.1 `AuthDirectivesSpec` (or nearest existing auth spec): session-cookie resolution yields
      `source=Ui`/`tokenId=None`; PAT bearer resolution yields `source=Pat`/`tokenId=Some(id)`.
- [x] 4.2 At least one service-level/integration test asserting an audit row recorded via a PAT
      request carries `source=pat` and the correct `actor_token_id`, alongside the equivalent
      session-cookie request recording `source=ui`/`actor_token_id=null`.
- [x] 4.3 Test: revoking/deleting a token does not alter a previously-recorded audit event's
      `actor_token_id` (soft reference, no cascade).
- [x] 4.4 Test: a scheduler-fired pipeline run's audit event carries `source=system`, not `ui`
      (design.md Decision 6 / skeptic design-1 CR1).
- [x] 4.5 Test: `MfaService.confirmEnrollment`/`regenerateBackupCodes`/`disable` invoked by a
      PAT-authenticated caller record `source=pat`/the correct `tokenId` on their `auth.mfa.*`
      event.
- [x] 4.6 `sbt compile test` green.

## 5. Verification

- [x] 5.1 Confirm no non-`AuthDirectives`/non-scheduler production `AuthenticatedUser(...)`
      construction site needs updating (default params cover the rest) — re-grep as of the actual
      diff, not just design time.
- [x] 5.2 Confirm `AuditSource.Mcp` remains unused by this change (Non-Goal) and is not
      accidentally wired without a real distinguishing signal.
- [x] 5.3 Confirm both `findUserByTokenHash` test-fake overrides (task 2.4) compile and pass
      against the new return shape.
