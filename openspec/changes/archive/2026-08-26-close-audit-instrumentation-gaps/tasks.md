## 1. Backend

- [x] 1.1 `UserRepository.upsertGoogleUser` returns `Future[(User, Boolean)]` (`wasCreated`),
      derived from the existing `findByGoogleId` branch — no extra DB round trip
- [x] 1.2 `AuthService.completeOAuth`: destructure `(user, wasCreated)`; when `wasCreated`, call
      `audit(Some(user.id), "auth.register")` before/alongside the existing
      `auditLoginOutcome(user.id, outcome)` call
- [x] 1.3 Re-grep `upsertGoogleUser` after 1.1 to confirm no other call site was missed
- [x] 1.4 `DataSourceService.refresh`: wrap the dispatch result in `.map`, auditing
      `"data_source.refresh"` (resourceId = the returned `DataSource.id`) only on `Right` — no
      per-kind helper edited
- [x] 1.5 `SourceService`: widen the private `audit` helper to accept an `action: String =
      "data_source.create"` param (existing two call sites unedited); `refresh` wraps its dispatch
      result in `.map`, auditing `"data_source.refresh"` (resourceId = `sourceId.value`, the
      pre-dispatch `DataSourceId` param already in `refresh`'s own signature — NOT the returned
      `DataType.id`; `resource_type` stays `"data_source"`, see design.md Decision 1 correction)
      only on `Right`
- [x] 1.6 Update `route-audit-enumeration.md`'s tracked-gaps section (find its current location —
      it moved when HEL-838 archived) to mark these three gaps closed

## 2. Tests

Host spec, refresh cases (2.3-2.6): `backend/src/test/scala/com/helio/api/
AuditMutationInstrumentationSpec.scala` (route-level, real `ApiRoutes`-constructed service tree).

Host spec, OAuth cases (2.1-2.2) — correction (skeptic round 1): `AuditMutationInstrumentationSpec`
cannot host these — its `ApiRoutes`-constructed `OAuthRoutes` has no seam to stub the Google
exchange, so routing through it would issue real network calls. Use
`backend/src/test/scala/com/helio/api/routes/auth/GoogleOAuthRoutesSpec.scala`'s established
pattern instead: a real `AuthService`/`AuditService`/embedded-Postgres `UserRepository`, wired to a
locally-constructed `new OAuthRoutes(authService, ...) { override protected def
exchangeCodeForTokenImpl(...); override protected def fetchGoogleProfileImpl(...) }` subclass that
stubs only the two outbound Google HTTP calls. Add 2.1/2.2 as new cases in
`GoogleOAuthRoutesSpec.scala` itself (preferred, reuses its existing fixtures) unless the executor
finds a reason to duplicate the same construction pattern elsewhere — state the actual choice made

**Executor's choice (implemented):** 2.1/2.2 were added as new cases directly in
`GoogleOAuthRoutesSpec.scala` (the preferred option). That spec had no audit fixtures before this
ticket (`auditService` stayed null-default) — added a real embedded-Postgres `AuditEventRepository`
+ `AuditService` in `beforeAll`, an `eventuallyAuditRows`/`allAuditRows` pair mirroring
`AuditMutationInstrumentationSpec`'s, and a `withAudit: Boolean = false` flag on `makeAuthService`
so every pre-existing test in the file (which constructs `AuthService` with no audit service) is
unaffected.
here once implemented.

- [x] 2.1 First-time Google signup writes exactly one `auth.register` row + exactly one login row
      (via `GoogleOAuthRoutesSpec`'s stubbed-`OAuthRoutes` pattern — see host-spec note above)
- [x] 2.2 Returning Google login writes no `auth.register` row — use the negative-assertion
      barrier: after the login call, issue a second real audited mutation, `eventuallyAuditRows` on
      that row first, then assert zero `auth.register` rows for this actor
- [x] 2.3 `DataSourceService.refresh` (each of static/csv/text/pdf/image, at least one kind covered
      end-to-end plus a table/loop for the rest if that keeps the spec readable) writes exactly one
      `data_source.refresh` row on success, with correct actor id / tokenId / source
- [x] 2.4 A failed `DataSourceService.refresh` writes no `data_source.refresh` row — barrier
      technique
- [x] 2.5 `SourceService.refresh` (sql and rest) writes exactly one `data_source.refresh` row on
      success, with correct actor id / tokenId / source
- [x] 2.6 A failed `SourceService.refresh` writes no `data_source.refresh` row — barrier technique
- [x] 2.7 Existing `AuthServiceSpec`/`DataSourceServiceSpec`/`SourceServiceSpec`/repository specs
      still pass with the `upsertGoogleUser` signature change and the widened `SourceService.audit`
      helper
