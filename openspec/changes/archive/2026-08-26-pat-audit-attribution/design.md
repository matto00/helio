## Context

`AuditService.record(actorUserId, actorTokenId: Option[ApiTokenId], source: AuditSource, ...)`
already accepts both fields this ticket needs to populate (HEL-471). `AuditSource` already defines
`Ui | Pat | Mcp | System` (a prior HEL-477 design round rejected an invented `AuditSource.Api`
member — `Mcp` is real, already there, not being added here). All 15 existing
`auditService.record(...)` call sites (enumerated in HEL-477's archived
`route-audit-enumeration.md`) currently hardcode `AuditSource.Ui` and `actorTokenId=None`
regardless of how the caller actually authenticated.

`AuthDirectives.resolveIdentity` resolves a session cookie OR a `helio_pat_`-prefixed bearer token
into a single `AuthenticatedUser(id: UserId)` with no memory of which path resolved it, or which
token id did the resolving. `ApiTokenRepository.findUserByTokenHash` (the PAT resolution path)
already runs the same privileged pre-auth query as the newer `findPrincipalByTokenHash` (added for
HEL-369 token scoping), which already demonstrates selecting `id` alongside `userId` — a directly
reusable shape for this ticket's own extension.

## Goals / Non-Goals

**Goals:**
- Every mutation's audit row reflects the real source (`ui` vs `pat`) and real `actor_token_id` of
  the request that produced it.
- Minimal call-site-by-call-site special casing: the value flows from one resolution point
  (`AuthDirectives`) through `AuthenticatedUser` for the 13 call sites that already have one in
  scope (mechanical edit), with `AuthService`/`MfaService`'s login-establishing paths and the
  scheduler's system-triggered path handled by explicit, individually-justified decisions
  (Decisions 5 and 6) rather than folded into the mechanical case.
- Token revocation never mutates or cascades into previously-written audit rows.

**Non-Goals:**
- Distinguishing `mcp` from generic `pat` — no reliable signal exists (no token label/scope,
  no distinguishing header helio-mcp sets that reaches this repo). MCP requests are recorded as
  `pat` per the ticket's own documented fallback; `AuditSource.Mcp` stays unused by this change,
  wired only once a real signal exists (follow-up, not filed by this ticket per the user's standing
  instruction not to file overnight follow-ups for known, already-flagged gaps).
- Changing the audit store schema, append-only enforcement, or query API — all HEL-471/prior-ticket
  territory, unmodified here.
- Re-auditing `WorkspaceTeardownService.teardown`, `DataSourceService.refresh`/`SourceService.refresh`,
  or `AuthService.completeOAuth`'s missing `auth.register` — all pre-existing HEL-477 gaps, out of
  scope for this ticket per the ticket text and the run's own standing instruction.

## Decisions

**Decision 1 — carry provenance on `AuthenticatedUser`, not as a second parallel value threaded
through every route.** Extend `AuthenticatedUser` with `source: AuditSource` (default `Ui` — see
Decision 4) and `tokenId: Option[ApiTokenId]` (default `None`). 13 of the 15
`auditService.record(...)` call sites already receive `user: AuthenticatedUser` in scope; each of
those edits becomes `auditService.record(Some(user.id), user.tokenId, user.source, ...)` instead of
`auditService.record(Some(user.id), None, AuditSource.Ui, ...)`. The remaining 2
(`AuthService`/`MfaService`'s login/register/logout paths) do NOT have an `AuthenticatedUser` in
scope at their audit call sites — see Decision 5, which covers them separately. (Skeptic design-1
CR2: an earlier draft of this decision claimed all 15 had `user: AuthenticatedUser` in scope;
`AuthService.scala:88` and `MfaService.scala:30` take `actorUserId: Option[UserId]` only, since
several of their call sites are establishing identity, not acting on an already-resolved one.)

**Decision 2 — extend `findUserByTokenHash` in place, not a second lookup call.** Rather than have
`AuthDirectives.resolveApiToken` call both `findUserByTokenHash` (for the user) and
`findPrincipalByTokenHash` (for the id) — two queries per PAT request — extend
`findUserByTokenHash`'s own query to also select `id`, mirroring `findPrincipalByTokenHash`'s
already-proven shape, and return `Option[(AuthenticatedUser, ApiTokenId)]` reshaped into the now
provenance-carrying `AuthenticatedUser` inside `resolveApiToken`. `findUserByTokenHash` has exactly
one *production* caller (`AuthDirectives.resolveApiToken`), which makes the in-place signature
change safe for production code — but it is also overridden by two test fakes,
`test/scala/com/helio/api/http/AuthDirectivesSpec.scala:40` and
`test/scala/com/helio/api/http/RateLimitDirectiveSpec.scala:50` (the latter unrelated to this
ticket's own scope but sharing the same repository interface), both of which must be updated to
the new return shape or the build fails to compile (task added under §2). "No second production
caller" is not the same claim as "no second caller" — corrected here per skeptic design-1 CR3.
`findPrincipalByTokenHash` is left completely unmodified (it also needs `scopedPipelineIds`, which
this ticket does not).

**Decision 3 — set `source=Pat` inside `resolveApiToken`, `source=Ui` inside `resolveIdentity`'s
cookie branch.** `resolveIdentity`'s cookie branch constructs its `AuthenticatedUser` via
`userSessionRepo.findValidSession`, which returns a plain `AuthenticatedUser` with no source field
set by the repository — `AuthDirectives` itself sets `source=Ui`/`tokenId=None` by mapping the
repository's result, rather than pushing an `AuditSource` concept down into
`UserSessionRepository`, which has no reason to know about audit sourcing.

**Decision 5 — `AuthService`/`MfaService`'s `audit(actorUserId: Option[UserId], ...)` helpers gain
explicit `source`/`tokenId` parameters, defaulted per call site, rather than being fed a phantom
`AuthenticatedUser`.** (Skeptic design-1 CR2.) Both helpers are used across a mix of
identity-establishing calls (no resolved credential exists yet) and already-authenticated calls
(a real `AuthenticatedUser` is in scope one frame up):
- `AuthService` (`auth.login`, `auth.login.failed`, `auth.login.challenged`, `auth.logout`,
  `auth.register`): every one of these events happens on the *session/cookie* login path — a PAT
  cannot be used to log in (it is itself a separate, already-authenticated credential minted only
  after a session exists), so `source=Ui` is not a leftover default here but the only correct value
  for this service; `actor_token_id` stays `None` throughout. The `audit` helper's signature is
  unchanged (`Option[UserId]` only) — no `AuthenticatedUser` ever needs to reach it.
- `MfaService`: `confirmEnrollment`/`regenerateBackupCodes`/`disable` (`:89`, `:99`, `:105`) DO
  have `user: AuthenticatedUser` already in scope as a method parameter and ARE reachable by a
  PAT-authenticated caller (re-auth via TOTP/backup code, not a fresh login) — these three call
  sites are changed to pass `user.source`/`user.tokenId` through to `audit`, whose signature grows
  `source: AuditSource = AuditSource.Ui, tokenId: Option[ApiTokenId] = None` (default-valued, so
  the two remaining call sites — `verifyLogin`'s `establishSession`/`recordFailedAttempt`, which
  resolve identity from an MFA challenge token, not a request credential — need no change and stay
  at the `Ui`/`None` default, consistent with `AuthService`'s login path since MFA verification is
  also part of establishing a session, not acting with an already-resolved one).

**Decision 4 — `AuthenticatedUser`'s default source is `Ui`, not left unset/`Option`-wrapped.**
`AuthenticatedUser` is constructed directly by ~166 test-fixture call sites plus one production
non-`AuthDirectives` site (`PipelineSchedulerService.scala:107`, handled explicitly by Decision 6
below, not by this default). A `source: AuditSource = AuditSource.Ui` default parameter (rather
than a bare, unguarded constructor argument) keeps every test call site compiling unchanged without
requiring a source to be specified at each of the ~166 sites, since none of them assert on audit
`source`/`actor_token_id` today. (Skeptic design-1 CR4: an earlier draft of this decision
mis-cited `DemoData` seeding as a beneficiary — `DemoData.scala` has zero `AuthenticatedUser`
occurrences; the real beneficiary is the test-fixture population, corrected here.)

**Decision 6 — the scheduler's constructed `AuthenticatedUser` gets `source=System`, not the
default `Ui`.** (Skeptic design-1 CR1.) `PipelineSchedulerService.scala:107` constructs
`AuthenticatedUser(pipeline.ownerId)` for a cron-fired run and passes it through
`PipelineRunService.submit(..., isDry = false, ...)`, which always calls `auditSubmit` →
`auditService.record(...)` for a non-dry run. Left at the `Ui` default, every scheduler-fired
`pipeline.run.submit` event would misattribute an unattended cron trigger to the browser UI. The
scheduler explicitly constructs its owner-`AuthenticatedUser` with
`source = AuditSource.System, tokenId = None` instead of relying on the default — this is also the
first production use of `AuditSource.System`, which previously existed in the model with no
producer (`audit-event-recording` spec's "accommodates non-request producers" requirement).
`audit-actor-attribution`'s spec delta gains a matching requirement for this (see spec file).

**Decision 7 — `actor_token_id`'s soft-reference guarantee is already satisfied by the existing
schema, not something this ticket adds.** `V91__audit_events.sql` (HEL-471) has no foreign key from
`audit_events.actor_token_id` to `api_tokens.id` — verified directly against the merged migration.
Revoking a token (`ApiTokenRepository.revoke`, a plain `DELETE FROM api_tokens`) therefore already
cannot cascade into or null out any `audit_events` row; this ticket adds a ScalaTest asserting that
behavior end-to-end (create token → mutate → revoke token → re-read the audit row) rather than
changing any schema.

`HookTriggerService` (`POST /api/hooks/run`) already resolves a token id independently via
`TokenScope.tokenId` (`HookTriggerService.scala:79`) for its own scoping purposes; its `user` will
now *also* carry `tokenId` from `AuthDirectives`. These are not a conflict — both derive from the
same token hash lookup on the same request — but are two reads of the same fact via different
paths; noted here so a future reader does not assume a second, potentially-diverging source of
truth (skeptic design-1 non-blocking note).

## Risks / Trade-offs

- Extending `AuthenticatedUser`'s shape touches every production construction site; mitigated by a
  default-valued `source`/`tokenId` (Decision 4) so non-`AuthDirectives` call sites need no edit.
- Recording MCP traffic as `pat` is a known, documented approximation (ticket's own Scope section
  anticipates this) — not a regression, and not silently swept under a wrong label.
