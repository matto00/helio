## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived from source in the worktree; round 1's report read only as a claim to re-check.

**Round-1 CR1 (wrong `resourceId` for `SourceService.refresh`) — FIXED, verified.**
- `SourceService.refresh(sourceId: DataSourceId, user)` returns `Future[Either[ServiceError, DataType]]`
  (`SourceService.scala:142`) — confirmed it returns a DataType, so the original instruction was
  genuinely wrong.
- Its private `audit` (`SourceService.scala:39-44`) hardcodes `resource_type = "data_source"`; both
  existing call sites (`:65`, `:92`) pass `Some(inserted.id.value)`, a DataSource id.
- design.md Decision 1 now carries the "Correction (skeptic round 1)" paragraph mandating
  `Some(sourceId.value)`; tasks.md 1.5 states it explicitly with an all-caps "NOT the returned
  `DataType.id`". Consistent with the spec delta ("`resource_id` equal to the source id"). Correct.
- The un-corrected earlier clause in Decision 1 ("no need to re-derive it from the pre-dispatch
  `sourceId` param") applies only to `DataSourceService.refresh`, which does return a `DataSource`
  (`DataSourceService.scala:544-548`) — that clause is correct as scoped, not a leftover contradiction.

**Round-1 CR2 (unreachable OAuth test host) — FIXED on the substance, verified.**
- `AuditMutationInstrumentationSpec` builds `new ApiRoutes(...).routes`; `ApiRoutes.scala:516`
  constructs `OAuthRoutes` with no stub seam — re-confirmed, so moving off it was the right call.
- `GoogleOAuthRoutesSpec.scala` really does use the described pattern: locally-constructed
  `new OAuthRoutes(makeAuthService(), ...) { override protected def exchangeCodeForTokenImpl / 
  fetchGoogleProfileImpl }` (`:185-189`, `:221-224`, and 6 more), over a real embedded-Postgres
  `UserRepository` (`:51-67`). The path under test (`completeOAuth` → `upsertGoogleUser` → `audit`)
  is genuinely exercised there. design.md's Test plan and tasks.md's task-2 preamble both name this
  host and drop the false "required, not merely preferred" claim. Accepted.

**Other ground-truth re-checks (all hold):**
- `AuthService.completeOAuth` (`:194-203`): `upsertGoogleUser` → `finishLogin` → `auditLoginOutcome`;
  no `auth.register`. Private `audit` at `:88-90` (`resource_type = "user"`, `tokenId = None`,
  `AuditSource.Ui`), and `auth.register` fires at `:119` only. Decisions 2 and 3 rest on true facts.
- `DataSourceService`: `refresh` at `:544` unaudited; parameterized `audit(action, resourceId, user)`
  helper at `:62` with `resource_type = "data_source"`, `user.tokenId`, `user.source`. Decision 1
  mechanics hold.
- Spec delta (`specs/audit-mutation-instrumentation/spec.md`) — three ADDED requirements, each with a
  positive and a negative scenario, matching the six ACs 1-5. AC 6 is covered by task 1.6.
- AC coverage: AC1→1.1/1.2/2.1/2.2; AC2→1.4/2.3; AC3→1.5/2.5; AC4→2.3/2.5; AC5→2.4/2.6;
  AC6→1.6. No task exceeds the ticket's scope; non-goals restate the ticket's scope discipline.

### Verdict: CONFIRM

Both round-1 blockers are genuinely closed against source, not merely narrated as closed. The
remaining defect I found (note 1 below) is real but is discovered at compile time by the executor,
is precedented in four existing specs, and its one silent-failure mode is already defeated by the
barrier the design mandates — it is a note, not a blocker.

### Non-blocking notes

1. **`GoogleOAuthRoutesSpec` has no audit fixtures at all — the artifacts overstate what is
   reusable.** design.md's Test plan calls it "a real `AuthService` (… real `AuditService`)" and
   tasks.md says it "reuses its existing fixtures". Ground truth: that spec constructs
   `new AuthService(userRepo, tierConfig, mfaService)` (`:84-88`) — `auditService` takes its `null`
   default, so **no audit rows are written there today**. The spec has no `AuditEventRepository`, no
   `DbContext`, no `eventuallyAuditRows` (that helper is private to
   `AuditMutationInstrumentationSpec:218`), and its `cleanDb()` TRUNCATE (`:91-93`) does not include
   `audit_events`. The executor must add, before 2.1/2.2 can pass: a `DbContext` over the existing
   `db`, `new AuditEventRepository(ctx)` (precedent: `AuditEventRoutesSpec:59`,
   `AuditEventRepositorySpec:87`, `PipelineSchedulerServiceSpec:98`), an `AuditService`, a new
   `auditService` param on `makeAuthService`, a local polling helper, and `audit_events` in the
   TRUNCATE. Mechanical, but worth stating as an explicit sub-task rather than leaving it as an
   inferred fixture.
   - **Hazard to flag to the executor:** if `makeAuthService` is not threaded, test 2.2 ("no
     `auth.register` row") passes *vacuously* — zero rows is trivially true when `auditService` is
     `null`. The design's mandatory negative-assertion barrier defeats this (the barrier's own
     positive `eventuallyAuditRows` would never drain), which is why this is not a blocker — but the
     barrier must not be skipped or weakened for 2.2.
2. **2.2's barrier needs a concrete second mutation named.** In `GoogleOAuthRoutesSpec` the only
   audited action reachable is the OAuth login itself. The natural barrier is: assert the returning
   login's own `auth.login` row via polling first, then assert zero `auth.register` for that actor.
   Worth writing down so the executor does not invent a cross-spec dependency.
3. Round 1's note 2 is unresolved and still applies: `AuthService.audit` hardcodes `tokenId = None` /
   `AuditSource.Ui` (`:88-90`). AC 4's "correct acting token id and source" for the `auth.register`
   row means asserting those literal values, not a token id this path never has.
4. Round 1's note 1 is unresolved: `route-audit-enumeration.md`'s tracked-gaps list holds only the
   two refresh gaps plus teardown; the OAuth-register gap is not an enumerated item. Task 1.6's "mark
   these three gaps closed" will not map cleanly onto the file — expect two marks plus a note.
