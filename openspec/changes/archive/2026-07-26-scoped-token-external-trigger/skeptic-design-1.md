## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, both spec deltas, and `tasks.md` in full.
- Read the ground-truth pre-change files named in the brief:
  - `backend/src/main/scala/com/helio/api/AuthDirectives.scala` — `authenticate`,
    `optionalAuthenticate`, `resolveApiToken`, `resolveIdentity`, `requireCsrfHeader`.
  - `backend/src/main/scala/com/helio/services/ApiTokenService.scala`
  - `backend/src/main/scala/com/helio/infrastructure/ApiTokenRepository.scala`
  - `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala`
  - `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (`submit`,
    `runPipeline`, `executeRun`, `history`, `TriggerSource`)
  - `backend/src/main/scala/com/helio/services/PipelineSchedulerService.scala` (`fire`,
    `fireIfNotOverlapping`)
  - `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala`
    (`insertRun`/`insertRunInternal`, `hasActiveRunInternal`)
  - `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — the **entire** authenticated route
    tree, including the `optionalAuthenticate` branch that is a *sibling* of the `authenticate`
    branch inside the same top-level `concat(...)` under `pathPrefix("api")`.
  - `backend/src/main/scala/com/helio/api/routes/PublicDashboardRoutes.scala` and
    `PublicUploadRoutes.scala` (the routes mounted under `optionalAuthenticate`).
  - `backend/src/main/scala/com/helio/api/AclDirective.scala` — `authorizeResourceWithSharing`.
  - `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`
    (`findByIdShared`, `findGrantRole`).
  - `backend/src/main/scala/com/helio/api/RequestValidation.scala`
    (`validateCreateApiTokenRequest`).
  - `ls backend/src/main/resources/db/migration/ | sort -V | tail -8` → highest existing is
    `V73__add_resource_tag.sql`; `V74` is genuinely free right now.

### 🚨 UNRESOLVED PRIVILEGE-ESCALATION / SCOPE-BYPASS FINDING (escalate to human)

The design's central claim — "a PAT minted with a non-null `scopedPipelineIds` allow-list SHALL
authenticate ONLY `POST /api/hooks/run`; every other authenticated route SHALL reject it with `403
Forbidden`" (spec.md, `request-authentication` capability) — **does not hold**, because the design
only touches one of *two* sibling branches that resolve a bearer credential to a full
`AuthenticatedUser`.

`ApiRoutes.scala`'s top-level `concat(...)` (lines 221-334) has three branches:

1. `pathPrefix("auth") { ... }` — unauthenticated (login/register).
2. `authDirectives.optionalAuthenticate { userOpt => concat(PublicDashboardRoutes, PublicUploadRoutes) }`
   — a **sibling** branch, not nested inside branch 3.
3. `authDirectives.authenticate { authenticatedUser => concat(...) }` — the big authenticated tree.

Design Decision 2 replaces `authenticate` with `authenticateScoped` and wraps **only branch 3's**
`concat(...)` in `restrictScopedToken(scope)`. It never touches branch 2. But branch 2's
`optionalAuthenticate` calls the *same* `identity` → `resolveApiToken` → `findUserByTokenHash`
resolution chain that `authenticate` uses (`AuthDirectives.scala` lines 91-100, sharing `identity`
at line 59) — a chain the design **deliberately keeps byte-for-byte unchanged** (Decision 3: "so
the existing unit test and the plain `authenticate` path... keep working"). That resolution path
has no notion of `scoped_pipeline_ids` at all — it hashes the bearer token, looks up the owning
user, and returns `Some(AuthenticatedUser)` for *any* valid token, scoped or not.

Concretely: `PublicDashboardRoutes.routes` (`GET /api/dashboards/{id}/panels`) calls
`aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, ...)`
(`AclDirective.scala` lines 83-86) — `Some(user) if user.id.value == ownerId => provide(ResourceAccess.Owner)`,
**no sharing check required** for the owner branch. So:

- A scoped token minted to (say) trigger one `helio-news` pipeline can be handed as
  `Authorization: Bearer helio_pat_...` to `GET /api/dashboards/<any-owned-dashboard-id>/panels`
  and will resolve via `optionalAuthenticate`/`resolveApiToken` to the real, full-authority
  `AuthenticatedUser` — completely bypassing `restrictScopedToken`, which is never invoked on this
  branch — and receive `200 OK` with that dashboard's panel/binding metadata, for *any* dashboard
  the underlying user owns, entirely unrelated to the token's pipeline allow-list.
- This directly contradicts the `external-run-hooks`/`request-authentication` spec scenario
  "Scoped token rejected on an unrelated route" (spec asserts `GET /api/dashboards` 403s a scoped
  token — true for the *authenticated*-tree `DashboardRoutes`, but the sibling public-dashboard
  read path is a different, unguarded route family reachable with the exact same credential).
- It also falsifies the design's own Risk/Trade-off claim ("a compromised scoped token can only
  re-trigger its allow-listed pipelines") — the actual blast radius of a leaked scoped token
  includes reading the panel/dashboard structure of every dashboard the token's owner has, which
  is a materially larger exposure than the ticket's stated threat model, and larger than what the
  "no rate limiting, mitigated by narrow scope" trade-off in `design.md` assumes.

Root cause: `design.md`'s Context section describes the pre-change surface as "a single flat
`concat(...)` tree" — this is not accurate; there are two sibling trees that resolve full user
identity from a bearer token (`authenticate`'s and `optionalAuthenticate`'s), and the design's
enforcement point (Decision 2) only gates one of them. Any future/other code path that continues
to call the unmodified `resolveApiToken`/`authenticate`/`optionalAuthenticate` — which is exactly
what the design intentionally preserves for compatibility — silently regains full,
scope-unaware authority for a token the ticket's spec promises is confined to one endpoint.

This is exactly the class of gap the orchestrator's pre-brief asked the design to settle
explicitly ("does a scoped token even reach that [public/optional-auth] tree, and if so with what
effect?") and it is currently unaddressed in `design.md`/`tasks.md`.

### Other findings

1. **(Non-blocking, but tied to the above)** Because `optionalAuthenticate` is the leak, simply
   patching `restrictScopedToken`'s path check is not sufficient — the design needs to either (a)
   introduce a scope-aware `optionalAuthenticate` variant used by `PublicDashboardRoutes`'s branch
   and apply the same "scoped tokens 403 outside `/hooks`" rule there too, or (b) resolve
   identity+scope once at the very top of `pathPrefix("api")` (before the three-way branch) and
   enforce confinement centrally, so no branch can independently re-derive an unscoped
   `AuthenticatedUser` from a scoped token's bearer value. `design.md` Decision 2 and `tasks.md`
   3.1-3.3 need to name which fix is chosen and touch the actual file/line where
   `optionalAuthenticate` is wired.

2. **Non-blocking mint-time gap.** `design.md` Decision 1 validates `scopedPipelineIds` at mint
   time via `PipelineRepository.findByIdShared(_, Some(user))` — which returns `Some` for viewer
   grantees too (`PipelineRepository.scala` lines 55-70), not just owner/editor. `submit()` (used
   by `HookTriggerService`) requires editor-or-owner and 403s viewers (`PipelineRunService.scala`
   lines 86-91). So a caller can mint a "successfully validated" scoped token against a pipeline
   they can only view, which will then always 403 at trigger time. Not a security hole (fails
   closed), but worth a design note or a tightened mint-time check (`findGrantRole` ==
   `"editor"` or owner) so token creation doesn't silently produce a token that can never
   succeed.

3. **Non-blocking robustness nit.** `restrictScopedToken`'s check ("`extractUnmatchedPath` starts
   with `/hooks`") is a raw string-prefix test, not a segment-boundary match. Currently safe
   (no other top-level route begins with the literal `hooks`), but recommend matching on the
   `hooks` path *segment* (e.g. via a `pathPrefix("hooks")`-shaped check or splitting on `/` and
   comparing the first segment) so a future sibling route (e.g. `/hooksomething`) can't
   accidentally fall inside the allow-list by substring coincidence.

4. **Confirmed sound.** `V74` is genuinely the next free Flyway version
   (`V73__add_resource_tag.sql` is the current max). `hasActiveRunInternal`'s
   `completedAt.isEmpty` predicate is coherent with the "collapse into in-flight run" mitigation
   and mirrors the scheduler's existing overlap-guard usage. `submit`→`executeRun`→`insertRun`→
   `history()`'s field list traces cleanly to `GET /api/pipelines/:id/run-history`, so threading
   `triggeredByTokenId` through those exact points (as planned) will reach the claimed audit read
   path. `PipelineSchedulerService.fire`'s call to `submit(...)` uses named/positional args that
   the design's new optional trailing param won't disturb. No path in the design re-exposes or
   logs the raw token; `CreateApiTokenResponse` remains the only surface that ever carries it.

### Verdict: REFUTE

### Change Requests

1. **(Blocking, security)** Revise `design.md` Decision 2 (and `tasks.md` 3.1-3.3) to explicitly
   account for the `optionalAuthenticate`/`PublicDashboardRoutes` branch in `ApiRoutes.scala`.
   State concretely how a scoped token is prevented from resolving to a full `AuthenticatedUser`
   on that branch — either a scope-aware `optionalAuthenticate` + confinement check there too, or
   a single identity+scope resolution point ahead of the three-way branch that all three branches
   consume. Add a spec scenario (`external-run-hooks` or `request-authentication`) covering "scoped
   token rejected on the public/optional-auth dashboard-read route," matching the existing
   "Scoped token rejected on an unrelated route" scenario's intent but naming this specific route
   family so it isn't missed at implementation/test time.
2. Tighten (or explicitly note as accepted) the mint-time validation gap: either require
   `findGrantRole == editor` (or owner) rather than any-shared-access when validating
   `scopedPipelineIds`, or document in `design.md` that a viewer-scoped token is expected to always
   403 at trigger time and that's acceptable.
3. Specify `restrictScopedToken`'s path match as a segment-boundary check, not a raw string
   prefix, to avoid future substring-collision routes silently falling inside the hook allow-list.

### Non-blocking notes

- The V74 migration plan, the `triggeredByTokenId` threading through `submit`/`executeRun`/
  `insertRun`/`history`, and the duplicate-trigger collapse via `hasActiveRunInternal` all check out
  against the current code and are sound as designed.
