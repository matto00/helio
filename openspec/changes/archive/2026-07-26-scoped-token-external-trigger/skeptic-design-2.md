## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md` (+ orchestrator security pre-brief), `skeptic-design-1.md` (round-1 REFUTE,
  in full), `proposal.md`, `design.md` (revised), `tasks.md` (revised),
  `specs/external-run-hooks/spec.md`, `specs/request-authentication/spec.md` — all in full.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (full file, lines 209-338): confirmed
  the top-level `concat(...)` under `pathPrefix("api")` (wrapped by `requireCsrfHeader`) has
  **exactly three** siblings — `pathPrefix("auth")`, `authDirectives.optionalAuthenticate { ... }`,
  `authDirectives.authenticate { ... }` — matching the design's claim byte-for-byte. `health.routes`
  is mounted outside `pathPrefix("api")` entirely (unauthenticated, no bearer resolution — not a
  4th branch to worry about).
- Confirmed via `grep` that `com.helio.app.Main.scala` calls `HttpServer.start(apiRoutes.routes, ...)`
  as the single bind point — no other route family is mounted anywhere else, so "exactly three
  branches" is exhaustive, not just locally true inside this one file.
- `backend/src/main/scala/com/helio/api/AuthDirectives.scala` (full file): re-verified
  `resolveIdentity` — `(Some(token), _) => Some(session lookup)` (cookie always wins over header,
  regardless of whether the session ultimately resolves) — confirms the design's claimed mirror
  ("if a session cookie is present at all, valid or not, `provide(None)` without inspecting
  `Authorization`") produces byte-identical precedence to today's `authenticate`/
  `optionalAuthenticate` for every combination: cookie+no-header, cookie+PAT-header (cookie wins,
  header ignored either way — including the "cookie present but invalid" case, which 401s via the
  branch's own resolution exactly as it does today, since `confineScopedToken` never touches this
  case), no-cookie+unscoped-PAT, no-cookie+scoped-PAT, no-cookie+no-header (fully anonymous).
- `AuthDirectivesSpec.scala:84` — confirmed the "prefer the session cookie over a simultaneously-
  present PAT header" test the design cites actually exists with that exact behavior.
- `backend/src/main/scala/com/helio/api/AclDirective.scala` (full file) and
  `PublicDashboardRoutes.scala` (full file): confirmed `authorizeResourceWithSharing`'s unconditional
  owner-match branch (`Some(user) if user.id.value == ownerId => provide(ResourceAccess.Owner)`) is
  still there, unchanged — i.e. the round-1 exploit path (resolve to full user via
  `optionalAuthenticate`, then walk straight through the owner branch) is real and would still fire
  if a scoped token ever reached this route's `aclDirective` call. Traced that with
  `confineScopedToken` wrapping **all three** branches (placed between `requireCsrfHeader` and
  `concat(...)`, per Decision 2 / task 3.2), a scoped token whose bearer resolves and whose first
  path segment is not `hooks` gets `complete(StatusCodes.Forbidden, ...)` at the chokepoint itself —
  the request never reaches `concat`, so branch 2's `optionalAuthenticate` → `PublicDashboardRoutes`
  → `AclDirective` never execute at all for that request. This closes the round-1 gap structurally
  (short-circuit before dispatch), not by patching the leaf.
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`: `findGrantRole`
  (lines 98-109) queries the grant table only (`resourceType/resourceId/granteeId`) and returns
  `None` for an owner (owners have no grant row) — confirms Decision 1 / task 2.4's plan ("owner
  check, **or** `findGrantRole == Some(\"editor\")`") is the only correct way to enforce
  editor-or-owner with this method; a bare `findGrantRole` check alone (without a separate owner
  check) would wrongly reject owners, and the design's task text explicitly calls for both. Verified
  this matches `PipelineRunService.submit`'s real gate (lines 83-94: owner path always permitted;
  non-owner requires `findGrantRole == Some("editor")`, else `Forbidden`) — so mint-time validation
  and trigger-time validation are now the same bar, closing round-1 finding #2.
- `backend/src/main/scala/com/helio/infrastructure/ApiTokenRepository.scala` (full file): current
  `findUserByTokenHash` shape confirms `findPrincipalByTokenHash` (Decision 3) is a straightforward,
  additive sibling method (same `withSystemContext` privileged pattern, same table) — not a
  fictional API being assumed into existence.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala`: confirmed
  `TriggerSource.External` is already reserved/unused (line 468, "no caller passes it yet"); `submit`
  callers (`PipelineRunSubmitRoutes.scala:27`, `BoundPanelService.scala:215`,
  `PipelineSchedulerService.scala:113`) all use ≤4 positional/named args, so appending a 5th
  `triggeredByTokenId: Option[String] = None` param is non-breaking, exactly as Decision 5 claims.
- `PipelineProtocol.scala`: confirmed current `jsonFormat8` (`PipelineRunRecord`) and `jsonFormat4`
  (`RunResultResponse`) — matches the design's stated bump targets (9/5).
- `ApiTokenProtocol.scala` / `RequestValidation.validateCreateApiTokenRequest`: confirmed current
  shapes are exactly as the design assumes (2-field `CreateApiTokenRequest`, no scope field yet;
  validation only checks name/expiry) — additive changes in tasks 2.2/2.3 are feasible as described.
- Flyway: `ls backend/src/main/resources/db/migration/ | sort -V | tail -3` → highest is
  `V73__add_resource_tag.sql`; `V74` is still genuinely free.
- Segment-boundary check: traced `extractUnmatchedPath` at the chokepoint's mount point (inside
  `pathPrefix("api")`, after `requireCsrfHeader`) — unmatched path for a real hook call is
  `/hooks/run`; first non-empty segment on `/`-split is `"hooks"` (exact match, passes). For a
  hypothetical `/api/hooksomething`, first segment is `"hooksomething"` — fails exact-equality,
  correctly rejected (round-1's flagged `startsWith` substring-collision risk is resolved by the
  revision, per Decision 2 / task 3.1's explicit "not a `startsWith`/prefix test" language).

### Focus-area findings

1. **Chokepoint closes the round-1 gap** — confirmed by trace above: `GET /api/dashboards/:id/panels`
   with a scoped-token bearer 403s at `confineScopedToken` before `concat`/`PublicDashboardRoutes`/
   `AclDirective` ever run. The new spec scenario ("Scoped token rejected on the public/optional-auth
   dashboard-read route") and task 8.2's regression test target exactly this path with exactly the
   attack shape round 1 found (scoped-but-unrelated-pipeline token, dashboard the token's *owner*
   legitimately owns) — the strongest test for this class of bug, not a weaker generic substitute.
2. **No new regression for legitimate traffic** — anonymous requests (no cookie, no header) get
   `provide(None)` unconditionally and reach public routes untouched; unscoped-PAT requests resolve
   to `None` at the chokepoint (unscoped ⇒ let the branch's normal `authenticate`/
   `optionalAuthenticate` handle it, full access preserved); session-cookie requests are decided
   purely by cookie presence, byte-identical to today's `resolveIdentity` precedence, so an
   unrelated scoped-PAT header riding alongside a session cookie is inert either way.
3. **Segment-boundary check is correct** for both the real-hook-match and the collision case (see
   trace above).
4. **Mint-time tightening is correct and matches `submit`'s real gate** — verified against actual
   `findGrantRole`/`submit` code, not just design prose.
5. **Task 8.2 is sufficient and correctly targeted** — it names the exact route, exact credential
   shape, and exact assertion (403, not silent owner resolution) that would have caught round 1.
6. **No new genuine flaw found.** Two purely non-blocking observations below.

### Verdict: CONFIRM

### Non-blocking notes

1. `tasks.md` 5.4 says "Wire `HookTriggerService`/`HookRoutes` into `ApiRoutes.scala` (see task
   3.3)" — section 3 only has tasks 3.1 and 3.2 (no 3.3). Harmless dangling cross-reference (the
   actual wiring intent is already stated clearly in 3.2's last two sentences), but worth a
   one-line fix during execution so the executor doesn't go looking for a task that doesn't exist.
2. The double token-hash lookup per scoped-PAT request (`confineScopedToken`'s speculative
   resolution, then the branch's own `authenticate`/`optionalAuthenticate` resolving the same token
   again) is explicitly called out and accepted in `design.md`'s Risks section with a reasonable
   justification (PAT traffic is the minority case; single indexed lookup on the already-privileged
   pool). No action needed, just confirming it's a deliberate, documented trade-off rather than an
   oversight.
