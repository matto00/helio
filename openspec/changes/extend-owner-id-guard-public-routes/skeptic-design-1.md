## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 258f80434f11ca9c920f50c0d8777fcff967b278 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Unauthenticated route set (design Context) is accurate.** `backend/src/main/scala/com/helio/api/ApiRoutes.scala:915-966`:
  `health.routes ~ pathPrefix("api") { requireCsrfHeader { rateLimit { confineScopedToken { concat(pathPrefix("auth") { concat(auth.routes, oauth.routes, mfaRoutesOpt.fold(reject)(_.verifyRoute)) }, optionalAuthenticate { PublicDashboardRoutes(... Some(outputHistoryService), Some(outputInsightReadService)), imageUploadServiceOpt.fold(reject)(PublicUploadRoutes), ConnectorCompletionRoutes }, authenticate {...}) }}}}`.
  `HttpServer.start(apiRoutes.routes, ...)` (`app/Main.scala:333`) is the only binding, so nothing else is mounted. `HealthRoutes` is just `path("health")`.
- **Route classes.** `AuthRoutes.routes` = register + login (`logoutRoute` is separate and authenticated). `OAuthRoutes.routes` = `google` + `google/callback` (missing/invalid state gives a fixed 400 `ErrorResponse`). `MfaRoutes.verifyRoute` = `mfa/verify`. `PublicUploadRoutes` = `uploads/image/<id>`, 404 `ErrorResponse("Not found")`. `ConnectorCompletionRoutes` = GET (`parameter("token")`) and POST on `connectors/completion`. `PublicDashboardRoutes` mounts `/history` (line 155) and `/insight` (line 176).
- **Connector refusals.** `ConnectorCompletionService.scala:98-109,140-175`: an empty, unknown or expired token, a non-pending connector and a wrong-owner caller all return the single `RefusalError` (400). The design's claim holds.
- **HEL-1852.** `EmailNormalizer.normalize` = trim + `toLowerCase(Locale.ROOT)`. `RequestValidation.validateRegisterRequest` normalises. `UserRepository.findByEmail` compares `lower(email)`. `AuthService.register` gives 409 `"email already registered"` (and also on the unique violation). Login gives `Unauthorized()` for unknown email, no hash and wrong password. Register always mints `UserId(UUID.randomUUID())`, which matters for CR1.
- **Existing spec.** `PublicRouteOwnerIdLeakSpec.scala:66,107-108`: ownerId is `0badc0de-1216-...`, and `PublicDashboardRoutes` is built without the history/insight services (the design is right). The owner row is inserted by raw SQL with no password (lines 97-99).
- **`OwnerIdGuard`** checks the body only (JSON walk, or a raw-string contains for non-JSON). Image bytes therefore go through the raw-string path. Headers need explicit extra calls, which D3 already asks for.
- **Spec delta.** The MODIFIED requirement name matches `openspec/specs/public-dashboards/spec.md:198` exactly.
- **Scope.** Every ticket AC and every owner-ruled case maps to a task (2.1-2.5, 3.1-3.2). There are no placeholders and no main-code or contract changes.

### Verdict: REFUTE

The plan is close. Three defects would let the new coverage pass vacuously, which is the exact failure this ticket exists to prevent.

### Change Requests

1. **D2: the auth account must be the distinctive owner id, and the spec must assert that (non-vacuity).** D2 allows the owner's password account to be created "via the real register path". `AuthService.register` always assigns `UserId(UUID.randomUUID())`, so an account registered that way can never carry `0badc0de-1216-...`. Every auth case would then check for an id that cannot appear, and the guard would pass trivially.
   - Revise D2 so the existing distinctive-id user row gets `owner@example.test` and a bcrypt hash written directly against that id. Use `UserRepository.insert(user, Some(hash))` with the fixed `UserId`, or update the existing row. Its MFA enrollment must be on that same id.
   - Add a positive control: e.g. `userRepo.findByEmail("OWNER@Example.Test")` returns `id == ownerId`, or a correct-password login (outside the guard) shows that id.
   - Make the same rule explicit for the upload, the pending connector and its token, the history points and the insight render: each must be owned by `ownerId`, and the spec must check this.

2. **D5 / task 3.1: where the route already holds the owning entity, the mutation must plant that entity's id, not the literal constant.** Planting the literal `ownerId` string only proves the guard reads that body. It does not prove the fixture connects the route to the owner, which is how CR1's vacuity would go unnoticed. Required:
   - login wrong-password branch (`AuthService.login`, `case Some(_)`): plant `user.id.value`;
   - register conflict (`case Some(_)`): bind it and plant the found user's id;
   - connector refusal for a stranger or non-pending connector: plant `connector.ownerId.value`;
   - upload success: plant `upload`'s owner id, if the model has one;
   - `/history` and `/insight`: plant an owner-derived value the route has in scope.
   The literal is acceptable only where no owner-bearing entity is in scope (unknown-id 404s, empty or unknown token, OAuth bad state, MFA bad challenge, `/health`). The design must say this, and each `mutation-<route>.txt` must state which kind of mutation it used.

3. **D4: the structural check is underspecified in ways that give false coverage or a silent pass.** Three changes:
   - **(a) Scope the scan to the mounted member, not the source file.** `ConnectorCompletionRoutes.scala` also defines `ConnectorCompletionTokenRoutes` and `ConnectorPendingRoutes` (lines 54, 76; both authenticated). `AuthRoutes.scala` holds the authenticated `logoutRoute`. `MfaRoutes.scala` holds `authenticatedRoutes` (`mfa`, `enroll`, `disable`, ...). A file-level scan of `path(...)` literals pulls these authenticated paths into the "public" set. The coverage table would then either claim them falsely or fail. The design must say the scan reads only the mounted member's body (`val routes` of the mounted class, `def/val verifyRoute`). It must also say how mount tokens map to classes, because the mounts are `auth.routes`, `oauth.routes`, `mfaRoutesOpt...verifyRoute` and `health.routes`: through `private val auth = new AuthRoutes(...)` (`ApiRoutes.scala:385,888-894`).
   - **(b) Remove the claim that "the failure mode is a loud false positive, never a silent pass", or make it true.** A literal scan cannot see a path added through a helper `Route` val/def, a non-literal matcher, or a `~`/`concat` reference to another route. Such a path passes silently. Specify that the scanner fails when a mounted member's body references anything it cannot resolve: any identifier of type `Route` other than directive literals, or any `path`/`pathPrefix` argument not built from string literals and the known segment matchers. Then an unreadable shape fails loudly.
   - **(c) Tie the coverage table to what the cases actually call.** A hand-written table can list a path that no guard case requests. Require each route-table entry to be matched by at least one request the guard actually sent: record every request path the cases issue and match it against the patterns. An entry with no issued request must fail.
   Task 3.2's mutation set must cover (a) and (b): a dummy path added in a mounted member must go red, and a dummy path in a non-mounted sibling class in the same file must not.

### Non-blocking notes

- A route the harness never mounts (`mfaRoutesOpt`/`imageUploadServiceOpt` folding to `reject`) gives a rejection 404. An unknown-id 404 cannot be told apart from that by status alone. Upload success (200 + bytes) and MFA bad challenge (a non-404 status) catch this, provided they run in the same harness instance. Say so in D3.
- "Committed failing first" in D5 should mean the red *output* file is committed. Committing a failing spec would leave a red tree at that commit.
- GET `connectors/completion` with no `token` hits `parameter("token")` and becomes a rejection handled by `TopLevelErrorHandlers` only when the full `ApiRoutes` is used. In direct construction it is an unhandled rejection. The executor should wrap the route in `Route.seal` or the top-level handlers so the real body gets checked.
