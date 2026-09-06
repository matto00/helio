## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Every load-bearing codebase claim in design.md's Context section was checked against the tree. **All are true** — this is an unusually well-grounded design document:

- `AclDirective.scala` (`backend/src/main/scala/com/helio/api/http/AclDirective.scala`) is exactly
  `class AclDirective(permissionRepo: ResourcePermissionRepository, registry: ResourceTypeRegistry)`.
  The anonymous-no-grant arm (line ~107) completes `StatusCodes.NotFound, ErrorResponse(notFoundMessage)`,
  textually identical to the resource-absent arm (line ~82). The "denial shape already exists" claim is correct.
- `PublicDashboardRoutes` takes `userOpt: Option[AuthenticatedUser]` as a constructor param and calls
  `authorizeResourceWithSharing` at two sites (lines 109, 132). Those are the *only* two callers in main —
  D5's "existing call sites compile unchanged" is trivially satisfied.
- `requireCsrfHeader` (`AuthDirectives.scala:179-181`) returns `pass` unconditionally for GET. Confirmed.
- `hasPublicViewerGrant` (`ResourcePermissionRepository.scala:89-90`) does read via `ctx.withSystemContext`.
  D6's precedent claim is correct.
- `AccessChecker.requireOwnerOnly(resourceType, resourceId, user, notFoundMessage)` returns
  `Future[Either[ServiceError, ResourceAccess]]` — matches tasks 2.4 verbatim.
- `DbContext(db, privilegedDb)` exposes `withUserContext`/`withSystemContext` as described; 119 test specs
  construct `new DbContext(...)`, of which only ~10 pass two distinct pools (`RlsOwnerTablesSpec`,
  `RlsSharingAwareTablesSpec`, `RlsPrivilegedDmlSpec`, `V100ZeroRootGuardNonSuperuserSpec`, ...). The
  `DbContext(db, db)` vacuity hazard is real and the majority case.
- Latest migration on the tree is `V100__zero_root_guard_rls_independent.sql`; V101 is correct today.
- There is genuinely **no OpenAPI document** — `openspec/` contains only `config.yaml`, `specs/`, `changes/`.
- `scripts/check-schema-drift.mjs` does what design says: parses `case class Name(params)` across
  `JsonProtocols.scala` + `api/protocols/**` and diffs property names 1:1 against a schema whose `title`
  matches the class name.
- Existing capability specs `openspec/specs/acl-enforcement/` and `openspec/specs/public-dashboards/` both
  exist, so classifying them as Modified Capabilities is correct.
- All cited UI primitives exist (`Modal`, `StatusChip`, `ConfirmInline`, `EmptyState`, `Toast`,
  `PipelineShareDialog.tsx`, `ApiTokensSection.tsx`).
- `npx openspec validate share-link-token-management --type change` → `Change ... is valid`.

I also traced each ticket acceptance criterion to a spec requirement and a task; and probed the six areas
the orchestrator named. The findings below are what survived.

### Verdict: REFUTE

The design is strong and the premise-validation work was real. The refusal is for a small number of
substantive gaps, one of which is a functional defect that would ship a broken share link.

### Change Requests

1. **A valid share token presented by a logged-in non-grantee is refused (403).** D5 places the token check
   "inside the anonymous branch". But `AclDirective.authorizeResourceWithSharing` branches on `userOpt`
   *first*: any authenticated Helio user who is not the owner and holds no grant falls into
   `case Some(user) => ... Success(None) => complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))`
   (AclDirective.scala ~line 98) and **never reaches the token check at all**. A share link opened by a
   recipient who happens to have a Helio session — a common case, and the *only* case for an embed rendered
   inside the product later — breaks with a 403. The ticket AC says "valid tokens authorize public read
   through the sharing path" without restricting to anonymous callers. Additionally, this introduces a
   second denial shape (403 "Forbidden" vs 404 notFoundMessage) reachable with a valid token, which is in
   tension with the single-exit property of D4. Resolve by evaluating the token before/independently of the
   `userOpt` branch (a valid token grants at least Viewer regardless of session), and add a spec scenario
   for "authenticated non-grantee presenting a valid token". If exclusion is genuinely intended, D5 must say
   so explicitly and the acl-enforcement spec must state it.

2. **The "shareable URL" in the create response has no defined origin.** `share-link-management-api/spec.md`
   requires the mint response to carry "the shareable URL derived from it", and task 4.1 lists a
   `create-share-token-response.schema.json` — but no decision in design.md says where the base URL comes
   from, and I confirmed the backend has **no** public/frontend base-URL config (no `*_BASE_URL` /
   `APP_URL` / `frontendUrl` in `backend/src/main/scala` or `application.conf`; the only `baseUrl` in the
   tree is the unrelated `Connector.baseUrl`). Deriving it from the request `Host` is wrong in production,
   where the frontend is `helioapp.dev` and the backend is a distinct Cloud Run host. Either add a decision
   naming a new documented env var (and add it to CLAUDE.md's table, per this repo's convention), or drop
   the URL from the response contract and have the frontend compose it from `window.location.origin` (the
   existing precedent in `ImagePanel.tsx`) — and amend the spec requirement to match. As written this is a
   deferred decision that blocks implementation.

3. **`share-link-management-api/spec.md` requires declaring the contract "in the OpenAPI document", which
   does not exist.** This directly contradicts design.md's own verified Context finding ("There is **no**
   OpenAPI document") and Planner Notes. It restates the stale ticket AC that design.md correctly refuted.
   Reword the requirement and its "Contract is discoverable" scenario to `schemas/**.schema.json` plus
   `openspec/specs/<capability>/spec.md`, so no implementer is instructed to edit a nonexistent file (or to
   satisfy the requirement vacuously).

4. **The timing half of the indistinguishability property is asserted by the specs but delivered by
   nothing.** `share-link-tokens/spec.md` states "Token validation SHALL NOT expose, by measurable
   response-time difference, whether a presented token exists", and the ticket AC names timing explicitly.
   design.md's Risks section addresses only the *narrow* axis (absent hash vs present-but-revoked hash, one
   row of difference) — and it addresses it well. It never addresses the **dominant** axis, which the
   ordering in D5 actually creates: an absent dashboard id short-circuits at `ownerResolver` after **one**
   query, while an invalid token against an *existing private* dashboard runs ownerResolver +
   `hasPublicViewerGrant` + the token lookup — **three** queries. That is a far larger, more measurable
   difference than the one mitigated, and it is precisely the "existence oracle for private dashboards"
   the ticket names. Note this asymmetry partly pre-exists on the no-token path, but this change is what
   promotes it to a written requirement. Required: either (a) state the timing scope honestly — restrict the
   spec requirement to status and body, and record the query-count asymmetry as a named, accepted residual
   risk with a rationale (and, if appropriate, a spinoff) — or (b) add a design mechanism that equalises it.
   Do not leave a SHALL in the spec that no task verifies and no decision implements.

5. **Task 6.6's RLS spec is at risk of being exactly the ceremony it is meant to prevent, because no
   decision assigns pools per repository method.** D6's reasoning is sound as far as it goes: anonymous
   validation must use `withSystemContext` (matching `hasPublicViewerGrant`), so RLS is not the boundary on
   the anonymous path. But task 1.4 only says "route every repository method through
   `ctx.withSystemContext`/`withUserContext`" without saying which is which. If `insert`/`findByDashboard`/
   `revoke` also use `withSystemContext` — trivially tempting, since ownership is already enforced in the
   service by `requireOwnerOnly` — then **no** application path ever reads `share_tokens` through the app
   pool, and a two-pool `ShareTokenRlsSpec` would be testing a policy that no shipped code path exercises:
   green, expensive, and meaningless. Required: name in design.md (or 1.3/1.4) which methods use which pool
   — the owner-facing create/list/revoke through `withUserContext(user.id)`, only `findActiveByHash` through
   `withSystemContext` with the mandatory inline justification comment DbContext's docstring requires — so
   6.6 asserts a property the product actually depends on.

6. **Section 6's mutation testing never exercises the indistinguishability axis, which is the ticket's
   central property.** Task 6.7's three mutations (ignore `revoked_at`, ignore `expires_at`, skip the
   resource binding) *are* three independent conjuncts of the validity predicate, not one axis relabelled —
   that part of the plan holds up. But all three fail in the same direction: they make the validator too
   *permissive*. None makes it too *chatty*, and it is the chatty direction that task 6.3 exists to catch.
   Because D4 deliberately funnels everything into one existing `complete(...)` line, 6.3 as written may be
   green from the moment it is written and stay green forever without ever having been able to go red —
   evidence-shaped non-evidence. Required: add a fourth mutation to 6.7 that gives one failure mode a
   distinct exit (e.g. make the revoked arm complete a different message or a 403) and record that **6.3
   specifically** turns red on it. Also require 6.7 to record the *named* test that each mutation reddens,
   since all three current mutations will redden 6.3 simultaneously — a mutation that reddens many tests
   demonstrates nothing about which test discriminates.

7. **6.3's comparison set is one baseline short.** Comparing the four invalid-token responses to each other
   (rather than to a hardcoded literal) is the right instinct and is stronger than a literal assertion — but
   the property the specs actually state is that those responses also equal the *baseline* denials. Extend
   6.3's set to include (a) an anonymous request with **no** token to the same private dashboard and (b) an
   anonymous request to a dashboard id that does not exist, and assert all six are identical in status and
   body. Without (b), the acl-enforcement scenario "Denial does not distinguish a real dashboard from an
   absent one" has no covering task.

8. **The `token` query parameter — the one interface HEL-593 must consume — is never pinned in a spec or a
   schema.** D1's choice of a query parameter is well justified (an iframe cannot set a header; the URL must
   *be* the credential) and does not paint HEL-593 into a corner — the token is dashboard-scoped and reusable
   by an embed route. D2 (SHA-256 at rest, no bcrypt/argon2 for a 256-bit CSPRNG secret, designing away the
   timing-safe-compare question rather than answering it) and D3 (`SecureRandom`, 32 bytes, base64url) are
   both right and match existing precedent. But `public-dashboards/spec.md` only says "presenting a valid
   share token" abstractly — the literal parameter name never appears in any spec or schema, and
   `check-schema-drift.mjs` covers bodies, not query params. Name `token` explicitly in the
   public-dashboards requirement text so the interface HEL-593 depends on is a written contract rather than
   an implementation detail.

### Non-blocking notes

- Task 6.5 cannot behaviourally verify the spec's "randomness originates from a cryptographically secure
  generator" — statistical uniqueness is satisfied by `scala.util.Random` too. Consider adding a cheap grep
  assertion (no `scala.util.Random` / `Math.random` in the token path) alongside it. `check:scala-quality`
  does not cover this.
- The shared-Postgres and Flyway-checksum hazards are correctly carried from ticket.md into D7 and task 1.1,
  including the re-derive-at-write-time instruction. No change needed.
- Scope discipline is clean: HEL-593 (embed route, frame-ancestors/CSP) and HEL-596/601 (PDF/PNG) are
  explicitly excluded in Non-goals, and nothing in tasks.md drifts toward them.
- The premise correction in ticket.md (both file paths stale, V59→V101) is accurate; I re-derived both
  independently.
