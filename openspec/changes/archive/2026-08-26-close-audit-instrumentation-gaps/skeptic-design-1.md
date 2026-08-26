## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/audit-mutation-instrumentation/spec.md.
- **AuthService.completeOAuth** (`services/auth/AuthService.scala:194-203`): confirmed it calls
  `userRepo.upsertGoogleUser(...)` then `finishLogin` then `auditLoginOutcome(user.id, outcome)` —
  no `auth.register`. The only `auth.register` call site is line 119 (password register). Gap real.
- **`private def audit`** at `AuthService.scala:88-90` — exists, takes `(actorUserId, action, metadata)`,
  hardcodes `resource_type = "user"` and `AuditSource.Ui`, tokenId `None`. Design's reuse claim holds.
- **UserRepository.upsertGoogleUser** (`UserRepository.scala:76-117`): confirmed it branches internally on
  `findByGoogleId` (`case Some(existingUser)` update / `case None` insert). `wasCreated` is computable with
  **no extra round trip** — Design Decision 2 verified true.
- **Caller blast radius:** `grep -rn upsertGoogleUser backend/src` returns the definition, exactly one call
  site (`AuthService.scala:197`), and two comment mentions. Design's "one call-site edit" verified.
- **DataSourceService.refresh** (`DataSourceService.scala:544-570`): single dispatch match returning
  `Future[Either[ServiceError, DataSource]]`; unaudited. Private `audit(action, resourceId, user)` helper
  exists at `:62` with `resource_type = "data_source"` and `user.tokenId`/`user.source`. Verified.
- **SourceService.refresh** (`SourceService.scala:142-153`): dispatches to `refreshSql`/`refreshRest`,
  returns `Future[Either[ServiceError, DataType]]` — **DataType, not DataSource**. Its private `audit`
  (`:39`) hardcodes `"data_source.create"` and is called at `:65` and `:92`, both passing
  `Some(inserted.id.value)` — i.e. a **DataSource** id. Verified.
- **ApiRoutes wiring** (`ApiRoutes.scala:233,250,251`): `auditService` already passed to `authService`,
  `dataSourceService`, `sourceService`. Design's "no route-wiring change needed" verified true.
- **route-audit-enumeration.md** located at
  `openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md`, tracked-gaps
  section at lines 93-118 (items 1/2 = the two refreshes; item 3 = teardown/HEL-838). Note the OAuth-register
  gap is **not** an enumerated tracked-gap item there (line 48 only records the login split) — see note 1.
- **HEL-838 barrier precedent** (`archive/2026-08-26-instrument-teardown-audit/design.md:84-103`): read;
  this design's restatement is faithful.
- **OAuth test seam** (`test/.../routes/auth/GoogleOAuthRoutesSpec.scala:29-36,181-190`): the stub works by
  **subclassing `OAuthRoutes` directly** and overriding `protected fetchGoogleProfileImpl` /
  `exchangeCodeForTokenImpl`, on a locally-constructed `new OAuthRoutes(makeAuthService(), ...)`.
- **`OAuthRoutes`** (`OAuthRoutes.scala:35-45,81-97,125-131`): the exchange/profile methods are `protected`
  members of the class; `ApiRoutes.scala:516` constructs `new OAuthRoutes(authService, googleClientId, ...)`
  with **no injection seam** — see Change Request 2.

### Verdict: REFUTE

Design Decisions 1-3 are sound and the ground-truth claims they rest on all check out. Two defects block
implementation as written: one is a concrete wrong-value instruction that contradicts the spec delta, the
other is a test plan mandated on a premise that is false against the code.

### Change Requests

1. **`tasks.md:1.5` (and `2.5`) specify the wrong `resource_id` for `SourceService.refresh`, contradicting
   the spec delta.** Task 1.5 says `resourceId = the returned DataType.id`. But `SourceService.refresh`
   returns `Future[Either[ServiceError, DataType]]` (`SourceService.scala:142`), and the audit row's
   `resource_type` is `"data_source"` (`SourceService.scala:39-44`) — writing a DataType id under
   `resource_type = data_source` is exactly the silent-wrongness this ticket exists to close. It also
   directly contradicts `specs/audit-mutation-instrumentation/spec.md` ("`resource_id` equal to the source
   id") and the file's own two existing call sites (`:65`, `:92`), which both pass a **DataSource** id.
   Fix: audit with `Some(sourceId.value)` — the `refresh` parameter, which is the DataSource id and is in
   scope. Update task 1.5 and the assertion in task 2.5 accordingly. (Note this is *not* symmetric with
   `DataSourceService.refresh`, where Decision 1's "read `id` off the returned domain object" is correct
   because that method returns a `DataSource`.)

2. **The mandated OAuth test host is not reachable as described — the design asserts a seam that does not
   exist.** design.md ("Host spec") states the route-level `AuditMutationInstrumentationSpec` path is
   "required, not merely preferred" for the OAuth case because `completeOAuth` "is only reachable through
   the real `OAuthRoutes`/`authService` construction path this spec already drives," and tasks 2.1/2.2 call
   for a "real OAuth-completion request." Ground truth: `AuditMutationInstrumentationSpec` builds routes via
   `new ApiRoutes(...).routes` (`:150`, `:174`, `:192`), and `ApiRoutes.scala:516` constructs `OAuthRoutes`
   internally with `googleClientId`/`googleClientSecret` defaulting to `""` and **no hook to stub
   `exchangeCodeForTokenImpl`/`fetchGoogleProfileImpl`** (they are `protected` methods, stubbable only by
   subclassing `OAuthRoutes` — the technique `GoogleOAuthRoutesSpec:185-189` uses on a *locally constructed*
   instance). A `GET /api/auth/google/callback` through the `ApiRoutes` tree would attempt real HTTP calls to
   `oauth2.googleapis.com`. Tasks 2.1/2.2 are therefore not implementable as written, and the design's
   "check whether a seam already exists before adding one" leaves the executor to improvise the plumbing
   mid-execution. Revise design.md's Host-spec section and tasks 2.1/2.2 to name one committed approach,
   e.g.: (a) drive the OAuth tests against an `OAuthRoutes` subclass constructed in the spec over the *same*
   `userRepo` + `auditService`-wired `AuthService`, accepting that this does not cover the `ApiRoutes:233`
   construction site (which is already independently covered by the existing `auth.register`/`auth.login`
   tests at `AuditMutationInstrumentationSpec:458,472`, so nothing is actually lost); or (b) explicitly add
   an injection seam to `ApiRoutes`/`OAuthRoutes` as a named backend task with its own scope justification.
   Either is fine — but pick one in the artifacts rather than leaving it as a discovery step, and drop the
   "required, not merely preferred" claim, which rests on a false premise.

### Non-blocking notes

1. `route-audit-enumeration.md`'s tracked-gaps list (lines 93-118) contains only the two refresh gaps plus
   teardown — the OAuth-register gap is **not** an item there. Task 1.6 says "mark these three gaps closed";
   the executor will find only two to mark. Suggest wording task 1.6 as "mark items 1 and 2 closed (item 3
   was HEL-838), and add a note that the `completeOAuth` row at line 48 now also emits `auth.register`."
   Ticket AC 6 is satisfied either way, but as written the instruction will not map cleanly onto the file.
2. AC 4 says each row carries "the correct actor id, acting token id and source." For the two refresh rows
   that is satisfiable via the existing helpers (`user.tokenId`/`user.source`). For the `auth.register` row,
   `AuthService.audit` hardcodes `tokenId = None` / `AuditSource.Ui` (`:88-90`) — correct for an OAuth
   browser signup, and consistent with the existing password-register row, but the test assertion for 2.1
   should assert those literal values rather than a "correct token id" the path never has.
3. Decision 1's action-name reuse (`data_source.refresh` across both services) is well-argued and matches
   the existing `data_source.create` reuse precedent at `SourceService.scala:41-43`. No objection.
