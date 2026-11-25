## Context

`PublicRouteOwnerIdLeakSpec` (HEL-1216) builds `PublicDashboardRoutes` directly over embedded Postgres with one
distinctive owner id (`0badc0de-1216-...`) and walks panels / rows / filter-capabilities / distinct-values /
output-meta / provenance through `OwnerIdGuard.assertNoOwnerId`. It constructs `PublicDashboardRoutes` WITHOUT the
`outputHistoryService` / `outputInsightReadService` arguments, so `/history` and `/insight` are never mounted.

The unauthenticated part of `ApiRoutes.routes` (backend/src/main/scala/com/helio/api/ApiRoutes.scala, ~line 915) is:
`health.routes` (outside `/api`); `pathPrefix("auth") { auth.routes, oauth.routes, mfaRoutesOpt...verifyRoute }`
(POST register, POST login, GET google, GET google/callback, POST mfa/verify); and `optionalAuthenticate { ... }`
mounting `PublicDashboardRoutes`, `PublicUploadRoutes` (GET uploads/image/:id) and `ConnectorCompletionRoutes`
(GET/POST connectors/completion). Only the BODY of the `authDirectives.authenticate { ... }` block is out of scope; a mount placed anywhere else in `val routes`, before or after it, is in scope.

Refusals: `ConnectorCompletionService.RefusalError` is one fixed 400 body for missing/unknown/expired token, a
non-pending connector, and a stranger holding a valid token. `PublicUploadRoutes` 404s with `ErrorResponse("Not
found")`. HEL-1852 (merged, 8abb826b7) added `EmailNormalizer` (case-insensitive unique email, V148) and changed
`AuthService` register/login; the auth cases must be written against that code, not the pre-HEL-1852 one.

## Goals / Non-Goals

**Goals:** every route in the unauthenticated part of `ApiRoutes.routes` is exercised by the guard (success bodies of
public reads; error bodies of auth routes); a mutation per new coverage point proves the guard goes red there
(a structural check for newly added routes was removed from this change; it moves to HEL-1881).

**Non-Goals:** helio-mcp OAuth endpoints; auth success bodies; any route behaviour change (unless a real leak is found).

## Decisions

**D1. Drive auth/upload/connector/health through the REAL `ApiRoutes` tree.** The
dashboard-route walk stays as is (direct `PublicDashboardRoutes`, now passed real `OutputHistoryService` and
`OutputInsightReadService` so `/history` and `/insight` are mounted). For the remaining routes, calling the real
`ApiRoutes.routes` (as `MfaApiRoutesSpec` / `TwoUserRlsApiFixture` already do) also proves the routes are mounted
where production mounts them, and exercises CSRF/rate-limit wrapping as production does. If wiring a full
`ApiRoutes` inside this spec proves impractical, the executor may build `AuthRoutes`/`OAuthRoutes`/`MfaRoutes`/
`PublicUploadRoutes`/`ConnectorCompletionRoutes`/`HealthRoutes` directly over real services and repositories, and
must say which it chose and why in files-modified.md. A sibling spec file (e.g. `PublicRouteOwnerIdLeakApiSpec`) is
acceptable if the existing class's fixture cannot host it cleanly; the ticket's intent is coverage, not one file.
As built: a sibling `PublicRouteOwnerIdLeakApiSpec` drives all 17 routes (dashboard routes included) through the real
`ApiRoutes` tree; the existing `PublicRouteOwnerIdLeakSpec` is unchanged and still checks the provenance success body.

**D2. Fixture data is owned by the distinctive owner id, and the spec proves it (non-vacuity).** `AuthService.register`
always mints `UserId(UUID.randomUUID())`, so the owner's password account must NOT come from the register path: the
existing distinctive-id user row gets email `owner@example.test` and a bcrypt hash written directly against that id
(`UserRepository.insert(user, Some(hash))` with the fixed `UserId`, or an update of the existing row); its MFA
enrollment is on that same id. Positive controls, asserted in the spec outside the guard: `findByEmail` of
`OWNER@Example.Test` returns `ownerId`; a correct-password login (not guarded) yields that id (or the MFA challenge for
it). Likewise the uploaded image, the pending connector and its completion token, the history points and the `ok`
insight render are all owned by `ownerId`, and the spec asserts each ownership (repository read) before guarding the
routes. Fake addresses only. Every assertion includes the HTTP status, so a 500 can't pass as "no leak".

**D3. Cases (each through `OwnerIdGuard.assertNoOwnerId`, body AND `Location`/`Set-Cookie` header values where present).**
- uploads/image: owner image success bytes (anonymous); random unknown UUID 404; malformed id.
- connectors/completion: GET with no token, unknown token, valid token (anonymous success shape), valid token as an
  authenticated stranger (refusal), expired token, completed (non-pending) connector; POST with unknown token,
  stranger with valid token, empty token.
- `/history`, `/insight`: public dashboard (OK, non-vacuous: assert the body really carries the rendered markdown /
  history points), private no token, wrong token, valid share token, stranger, nonexistent dashboard; non-insight
  panel for `/insight` (404).
- `/health`.
- Mount proof: a route the harness never mounts (`mfaRoutesOpt`/`imageUploadServiceOpt` folding to `reject`) gives a
  rejection 404 indistinguishable by status from an unknown-id 404, so upload success (200 + bytes) and MFA bad
  challenge (non-404) MUST run in the same harness instance as the 404 cases. If routes are built directly, wrap them
  in `Route.seal` (or the `TopLevelErrorHandlers` handlers) so rejections such as a missing `token` parameter produce
  the real body that gets checked.
- auth: login wrong password for `owner@example.test` and `OWNER@Example.Test`; login unknown email; register
  duplicate of both casings; MFA verify with bad challenge and bad code; `google/callback` with bad state, missing
  state; `google` start (redirect `Location`).

**D4. Structural coverage check: REMOVED.** A source-scan structural check (fails when a new unauthenticated route is added
without coverage) was built and then removed from this change after review found scanner escapes (for example a
`pathPrefix` + `pathEnd` route with no method directive, and a prefix mis-attribution for a mount after the `/api` block).
The 17-route guard coverage stands on its own; the structural check moves to HEL-1881 (runtime route-tree check).

**D5. Mutations (C12).** (The red-first structural evidence and the structural mutations were removed together with the check.)
(the spec itself is not committed red if the hook refuses; the .txt is the evidence). Then each coverage point gets one
mutation in MAIN code, run against the full spec, red naming that route, reverted, saved as `mutation-<route>.txt`
stating which kind of mutation it used:
- Owner-entity mutation where the route already holds an owner-bearing entity: login wrong-password branch plants
  `user.id.value`; register conflict binds the found user and plants its id; connector refusal for a stranger or a
  non-pending connector plants `connector.ownerId.value`; upload success plants the upload's owner id (if the model has
  one; otherwise state so and use the literal); `/history` and `/insight` plant an owner-derived value in scope (the
  pipeline/output owner id).
- MFA verify with a VALID challenge but a bad code plants `challenge.userId.value` (MfaService, the InvalidCode branch
  after the challenge is found).
- Literal `ownerId` string only where no owner-bearing entity is in scope: unknown-id 404s, empty/unknown token, OAuth
  bad state, MFA unknown challenge, `/health`.
- Executor notes from design round 2: define D4(b)'s "unresolvable" rule concretely (route-building calls vs. plain
  helpers) and record it in files-modified.md; compose path patterns through nested prefixes, handling both the
  directly-built (no `/api`) and full-tree (`/api`, `/api/auth`) prefixes; the `findByEmail` control proves the id,
  the login control (MFA on) yields the challenge token used by the bad-code case.
`git diff` on main code must be empty at commit.

## Risks / Trade-offs

- Full `ApiRoutes` construction is large; mitigated by reusing an existing harness pattern (D1 fallback allowed).
- The rate limiter wraps `/api`: many anonymous calls in one spec may hit `RATE_LIMIT_REQUESTS_PER_WINDOW` (120);
  configure the harness with a high limit rather than reduce coverage, and assert no 429 appears.
- No structural check ships here (D4); HEL-1881 owns it.

## Planner Notes

- Design gate round 1 REFUTE addressed: CR1 (D2 non-vacuity), CR2 (D5 owner-entity mutations), CR3 (D4 a/b/c).
- Self-approved: D1 fallback to direct route construction; sibling spec file allowed.
- Owner ruling (escalation answered `include-auth-error-bodies`): auth error bodies and `/health` in scope.
