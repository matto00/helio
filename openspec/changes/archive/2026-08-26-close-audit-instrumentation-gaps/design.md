## Context

Three unaudited mutation paths, each following an established pattern already used throughout
`backend/src/main/scala/com/helio/services/`:

1. **`AuthService.completeOAuth`** (`AuthService.scala:194`) calls
   `userRepo.upsertGoogleUser(profile.sub, email, profile.name, profile.picture, tierConfig)` then
   `finishLogin`, then `auditLoginOutcome(user.id, outcome)`. `upsertGoogleUser`
   (`UserRepository.scala:76`) already internally branches on `findByGoogleId` returning
   `Some`/`None` — the create-vs-update fact is computed inline today and simply discarded before
   it reaches the caller.
2. **`DataSourceService.refresh`** (`DataSourceService.scala:544`) is a single dispatch match on
   source kind (Static/Csv/Text/Pdf/Image), each arm returning `Future[Either[ServiceError,
   DataSource]]`. The service already has a parameterized private `audit(action, resourceId, user)`
   helper (`:62`), used at 8 other call sites (`data_source.create`/`update`/`delete`).
3. **`SourceService.refresh`** (`SourceService.scala:142`) dispatches to `refreshSql`/`refreshRest`,
   each returning `Future[Either[ServiceError, DataType]]`. This service's private `audit` helper
   (`:39`) is narrower — it takes no `action` param and hardcodes `"data_source.create"`, because
   today it only ever fires from the two create call sites.

Both `refresh` methods already receive `user: AuthenticatedUser` (HEL-483: carries `tokenId`/
`source`), so no new attribution plumbing is needed anywhere.

## Goals / Non-Goals

**Goals:**
- Emit exactly one `auth.register` row for a first-time Google signup, in addition to the existing
  login row; zero spurious rows for a returning login.
- Emit exactly one audit row per `DataSourceService.refresh` / `SourceService.refresh` call, on
  success only, regardless of which per-kind helper it dispatched to.
- Reuse the existing `audit(...)` helper and action-naming conventions in every file touched; no
  new pattern introduced.

**Non-Goals:**
- `WorkspaceTeardownService.teardown` — already shipped, HEL-838.
- Any other gap in `route-audit-enumeration.md` not named in this ticket.
- Auditing the individual per-kind refresh helpers separately — one row per public call only
  (Decision 1).

## Decisions

**Decision 1 — One audit row per `refresh` call, at the public entry point, gated on success.**
Directly following HEL-477 Decision 7 (one row per actor-initiated composite call) and HEL-838
Decision 2's identical precedent: `refresh` fans out to a private per-kind helper, but the
actor-initiated action is "refreshed source X," not "ran helper Y." Both `refresh` methods'
signature — a single `Future[Either[ServiceError, T]]` regardless of which arm ran — makes this
mechanical: `.map` the dispatch result once, auditing only on `Right`. This also directly satisfies
the "failed refresh writes no success row" acceptance criterion for free — a `Left` never reaches
the audit call, no separate error-path code needed.

Action naming: `data_source.refresh` for `DataSourceService.refresh` (matching its existing
`data_source.create`/`update`/`delete` triple, same `resource_type = "data_source"`,
`resourceId = Some(source.id.value)` recovered from the `Right(ds)` result — no need to re-derive
it from the pre-dispatch `sourceId` param, since the returned `DataSource.id` is definitionally the
same value and this keeps the audit call symmetric with the other three call sites in the file,
which all also read `id` off the returned domain object). `SourceService.refresh` reuses the same
`data_source.refresh` action / `data_source` resource_type as `DataSourceService`'s existing
`data_source.create` reuse across both services (design.md precedent already established at
HEL-477 Decision 8, restated in `SourceService`'s own `audit` helper comment) — both services
mutate the same underlying `DataSource`, this is not a new resource_type. **Correction (skeptic
round 1):** `SourceService.refresh`'s `resourceId` MUST be `Some(sourceId.value)` — the pre-dispatch
`DataSourceId` parameter already in scope in `refresh`'s own signature — never the returned
`DataType.id`. The method returns a `DataType`, but the audited resource is the `DataSource` being
refreshed (`resource_type = "data_source"`, matching `SourceService`'s existing two call sites,
both of which already key off the source id, not a data-type id); auditing `DataType.id` under
`resource_type = "data_source"` would record the wrong id for the stated resource type.

`SourceService`'s private `audit` helper is widened to take an explicit `action` param (defaulting
to `"data_source.create"` so its two existing call sites need no edit), rather than adding a
second, near-duplicate helper — the file already has exactly this shape in `DataSourceService`.

**Decision 2 — `upsertGoogleUser` returns `Future[(User, Boolean)]`; no second round trip.**
The repository already computes `existingUser` vs. builds a fresh `User` on the two branches of its
own internal `findByGoogleId` match (`UserRepository.scala:83-116`) — `wasCreated` is simply
`true` on the `case None =>` (insert) branch and `false` on `case Some(existingUser) =>` (update)
branch, returned alongside the `User` already being returned. This changes `upsertGoogleUser`'s
call signature; its only caller is `AuthService.completeOAuth` (verified: `grep -rn
upsertGoogleUser backend/src/main/scala` returns exactly the definition site plus one call site),
so the blast radius is one call-site edit.

Alternative considered and rejected: a second `findByGoogleId` lookup in `completeOAuth` after the
upsert, to infer creation from `createdAt == now`-ish timestamp comparison. Rejected: an extra DB
round trip on every OAuth login (the common case is a returning user) to recover a fact the
repository already has for free, plus a timestamp-proximity check is exactly the kind of
approximate signal that produces the "silently wrong for the wrong reason" failure this ticket
exists to close.

**Decision 3 — `auth.register` fires from the same private `audit(...)` helper `register` already
uses, with the same action string, not a new "oauth.register" action.**
The acceptance criteria and the existing single `auth.register` call site both treat "an account
was created" as the fact being recorded — the auth *method* (password vs. Google) is not part of
today's `auth.register` semantics anywhere else in the audit trail (contrast `auth.login` vs. no
separate `auth.login.google`), and inventing a new action here would fragment queries/dashboards
built against `auth.register` for no benefit the acceptance criteria ask for. `completeOAuth`
already computes `wasCreated` (Decision 2); the call becomes
`if (wasCreated) audit(Some(user.id), "auth.register")` immediately before the existing
`auditLoginOutcome(user.id, outcome)` call — both fire on first-time signup (matching the intent:
"writes an `auth.register` row *in addition to* the login row").

## Test plan

- **Negative-assertion barrier, mandatory for every "no row" assertion** (HEL-838 design.md
  precedent, directly applicable — `AuditService.record` is fire-and-forget everywhere in this
  codebase, so asserting zero rows immediately after a call is unfalsifiable on its own): the
  returning-Google-login test and the failed-refresh test MUST issue a second, real audited
  mutation after the call under test, `eventuallyAuditRows` on *that* row first to prove the write
  path has drained, THEN assert zero rows for the action/resource under test.
- **Host spec, refresh cases (`DataSourceService.refresh` / `SourceService.refresh`):**
  `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala` — the existing
  route-level spec, real HTTP requests through the actual `ApiRoutes`-constructed service tree
  (already wires `auditService` into `dataSourceService`/`sourceService` at construction —
  verified, no route-wiring change needed for this ticket, unlike HEL-838 which had to add
  wiring).
- **Host spec, OAuth cases — correction (skeptic round 1): NOT `AuditMutationInstrumentationSpec`.**
  That spec drives `new ApiRoutes(...).routes`, and `ApiRoutes.scala`'s `OAuthRoutes` construction
  site has no seam to stub the Google token/profile exchange — routing the OAuth test cases through
  it would issue real outbound network calls. The existing, already-established seam is
  `GoogleOAuthRoutesSpec` (`backend/src/test/scala/com/helio/api/routes/auth/
  GoogleOAuthRoutesSpec.scala`): a real `AuthService` (real embedded-Postgres-backed `UserRepository`,
  real `AuditService`) wired to a locally-constructed `new OAuthRoutes(authService, ...) { override
  protected def exchangeCodeForTokenImpl(...); override protected def fetchGoogleProfileImpl(...) }`
  subclass that overrides just the two Google HTTP calls — this still exercises the real
  `AuthService.completeOAuth` → `upsertGoogleUser` → `audit(...)` path end to end (the thing that
  actually matters for this ticket), it just skips constructing the unrelated rest of `ApiRoutes`.
  Add the two new OAuth audit assertions (2.1/2.2) either as new cases in
  `GoogleOAuthRoutesSpec.scala` itself (preferred — same fixtures, same construction pattern
  already proven there) or, if `AuditMutationInstrumentationSpec.scala` needs its own OAuth
  coverage for consistency with the other two gaps in this same ticket, its OAuth cases must
  construct `OAuthRoutes` the same locally-subclassed way `GoogleOAuthRoutesSpec` does — reusing
  the real `authService`/`auditEventRepo` already in that spec's fixtures — rather than routing
  through the full `ApiRoutes`-constructed `OAuthRoutes`. State which of the two hosts is used in
  tasks.md so the evaluator can verify it.
- Failed-refresh test: force a `Left` from the dispatch (e.g. a CSV source whose backing file is
  missing — `refreshCsv`'s existing `BadRequest`/`InternalError` arms) and assert, via the barrier,
  that no `data_source.refresh` row was written for that call.

## Risks / Trade-offs

- `upsertGoogleUser`'s signature change touches exactly one call site (verified above) — low risk,
  but the executor should re-grep after editing to confirm no other caller was missed by this
  design-time search.
- Reusing `data_source.refresh` across both `DataSourceService` and `SourceService` means the audit
  query UI cannot distinguish "refreshed via the static/csv/text/pdf/image path" from "refreshed
  via the sql/rest path" by action name alone — acceptable, since neither the acceptance criteria
  nor any existing audit-UI consumer asks for that distinction, and `resource_id` still identifies
  the specific source either way.
