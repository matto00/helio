## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of HEL-477 at `f433e7b5` (on `86ce5f37`), diffed against `main`. Every
conclusion below is derived from the files/commands named, not from
`evaluation-2.md` or `files-modified.md`.

### What I verified (with evidence)

**Gate — backend-test (the only gate whose `when` matches; diff touches
`backend/**` and `openspec/**`, zero `frontend/**` files, so lint/format/npm-test/
build do not apply and the UI/design-judgment section is legitimately skipped).**
Re-run fresh by me, not taken from the evaluator's report:

```
cd backend && sbt -batch compile test
[info] Run completed in 3 minutes, 5 seconds.
[info] Total number of tests run: 3434
[info] Suites: completed 219, aborted 0
[info] Tests: succeeded 3434, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
EXIT=0
```

`AuditMutationInstrumentationSpec` is present in the run (log line 3648).

**Prod wiring is real, not just constructor-shaped.** The nullable-default pattern
(`auditService: AuditService = null` + an `if (auditService != null)` guard per
service) is the highest-risk part of this change: a miswired service would silently
audit nothing while every test still passed. Checked directly —
`ApiRoutes.scala:181` builds `auditService` from the repo, and all 15 mutating
services receive it at `:223,224,225,230,236,240,241,242,243,250,270,325,333,341,351`.
`Main.scala` passes `auditEventRepo` through. No mutating service is left on the
`null` default in the production path. The `= null` optional-dependency idiom is
pre-existing house style here (`PipelineRunService.scala:39,43,49`,
`PanelCapabilityService.scala:45`), so it is not a new smell introduced by this change.

**AC 1 — "each mutation writes exactly one audit row with correct
action/resource/actor."** Traced each Decision to its call site rather than to the
report: Decision 2 fire-only-on-success (`DashboardService.scala:99` gates on the
`created` flag, so the `ifExists=return` no-op writes nothing; `:122-127` audits only
the `Right` branch); Decision 7 one-row-per-call for composites
(`DashboardService.scala:172` duplicate, `PanelService.scala:375,439` batch
create/update, `DashboardContentsService.scala:95` replace,
`DashboardService.scala:299` import); Decision 8 uniform `data_source.create` across
all `DataSourceService` create variants (`:145,201,285,383,476`) and
`SourceService.scala:65,92`; Decision 6 login split (`AuthService.scala:162,169,170`,
`MfaService.scala:161,175`, `completeOAuth` at `:194-201` reusing
`auditLoginOutcome`); Decision 11 MFA lifecycle (`MfaService.scala:89,99,105`, with
`startEnrollment` correctly emitting nothing).

**AC 2 — failed login carries no secret.** `AuthService.scala:157-162`:
`auditFailedLogin` passes `JsObject("identifier" -> ...)` only; the raw password is
never passed into `record` at all. Asserted at
`AuditMutationInstrumentationSpec.scala:446-460` including a negative assertion that
the metadata does not contain the attempted password.

**AC 3 — audit failure never fails the request.** `AuditMutationInstrumentationSpec.scala:467-493`
wires a real `ApiRoutes` with an `AuditEventRepository` whose `append` always returns
`Future.failed`, then asserts `POST /api/dashboards` still returns 201. This is a
call-site-level assertion through the real route tree, not a re-test of
`AuditService`'s own swallow.

**Decision 10 rollback exception — the subtlest requirement, and correctly built.**
`DashboardService.deleteInternal` (`:139`, `private[services]`) contains the delete
logic with no audit call; the public `delete` (`:122`) wraps it and audits.
`DashboardProposalService.scala:98` calls `deleteInternal`. The regression test
(`AuditMutationInstrumentationSpec.scala:645-698`) is genuine, not vacuous: it
engineers a real pre-validation/creation-time asymmetry (a metric bound to a DataType
flipped to a companion type by direct SQL after metric creation) so panel 2 fails at
`PanelService.rejectUnresolvableMetric` after the dashboard row already exists, then
asserts one `dashboard.create` and zero `dashboard.delete` for that id. It exercises
the fixed path.

**Test realism.** The spec runs against embedded Postgres with the real Flyway
migrations and a real `AuditEventRepository` (`:73-96`), matching the ticket's
"real/embedded audit repo" requirement, and correctly never wipes `audit_events`
(HEL-471's append-only trigger) — instead scoping per test by action/actor/timestamp.

**Out-of-scope judgment — I checked it myself rather than accepting it.**
`DataSourceService.refresh`, `SourceService.refresh`, and
`WorkspaceTeardownService.teardown` mutate resources but are genuinely outside the
ticket's enumerated Scope (which names create/update/delete of the listed resource
types, plus auth/token events). Agreed: correctly excluded and honestly recorded in
`route-audit-enumeration.md`. Follow-up ticket noted below, not a required revision.

### Verdict: REFUTE

One narrow, reproducible gap: two pipeline-**step** mutations that the ticket's Scope
does name are left with no audit row, and leaving them out contradicts this change's
own Decision 7 reasoning, which explicitly ruled the analogous panel/dashboard
`duplicate` paths *in*.

The ticket Scope reads "create/update/delete of dashboards, panels, pipelines
(+ steps/runs submit)". `PipelineService.duplicateStep` (`PipelineService.scala:737`)
persists a **new** pipeline step, and `PipelineService.reorderSteps` (`:700`)
persists a step-position update — both durable step mutations, both writing zero
audit rows today. `route-audit-enumeration.md` §"Tracked gaps" item 4 lists them, but
its stated reason ("not explicitly enumerated beyond create/update/delete") is exactly
what the Scope bullet *does* enumerate for steps. Note also that design.md Decision 9
claims to have "independently re-walked every `post`/`put`/`patch`/`delete` directive"
— these two directives falsify that claim, so this is a gap the design never actually
ruled on, not a settled decision being reopened.

This is not a subjective preference: `dashboard.duplicate` and `panel.duplicate` are
both instrumented (`DashboardService.scala:172`, `PanelService.scala:320`), so the
shipped trail records "duplicated a panel" but silently drops "duplicated a pipeline
step." Audit gaps are silent by nature — cheap now, expensive to discover later.

### Change Requests

1. **`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:737`
   (`duplicateStep`)** — emit one audit row on the success branch, mirroring the
   existing `panel.duplicate` call site (`PanelService.scala:320`): action
   `pipeline.step.duplicate` (or `pipeline.step.create`, if you prefer the trail to
   show duplication as an ordinary step creation — either is defensible, but state
   the choice in design.md), `resourceType = "pipeline_step"`, `resourceId` = the
   **new** step's id, `metadata` carrying the source `stepId`. Fire only on `Right`,
   via the existing private `audit(...)` helper (`:58`).

2. **`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:700`
   (`reorderSteps`)** — emit one audit row per call on the success branch (not one
   per step, per Decision 7's one-row-per-actor-initiated-call principle): action
   `pipeline.step.reorder`, `resourceType = "pipeline"`, `resourceId` = the
   `pipelineId`, `metadata` carrying the resulting ordered step ids.

3. **Update the two artifacts so they stop disagreeing with the code** — move these
   two rows out of `route-audit-enumeration.md`'s "Tracked gaps" section into the
   in-scope table, and add them to design.md's Decision 9 enumeration (whose
   "walked every directive" claim is currently inaccurate).

4. **Add integration coverage** for both, in
   `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`,
   in the style of the existing `panel.duplicate`/`batch_update` cases: assert
   exactly one row with the correct action/resource/actor per API call.

### Non-blocking notes

- **OAuth first-time signup emits no `auth.register`.** `AuthService.completeOAuth`
  (`:194-201`) calls `userRepo.upsertGoogleUser`, which may create a brand-new
  account, but only ever audits the login outcome — so the trail cannot distinguish a
  Google *signup* from a returning Google *login*. The ticket does name "register" as
  an auth event. I am not making this a Change Request because `upsertGoogleUser`
  returns no created/existing flag, so fixing it means a repository signature change
  beyond this ticket's "call the service" shape. Worth a follow-up.
- **Recommend a follow-up ticket for `WorkspaceTeardownService.teardown`**
  (`route-audit-enumeration.md` tracked gap 3). I agree it is out of *this* ticket's
  scope, but it is the highest-blast-radius mutation in the route tree and currently
  has zero audit trail — the single most valuable next increment for this epic. The
  two `refresh` gaps (items 1–2) can ride along.
- **`eventuallyAuditRows` can under-detect a duplicate row.**
  (`AuditMutationInstrumentationSpec.scala:188-196`) It stops polling at the *first*
  match, so a `should have size 1` assertion passes as soon as one row lands; a
  spurious second row written a few ms later would not be seen. The "exactly one row"
  AC is therefore slightly weaker than it reads. A short settle delay before the final
  count, or re-reading once after a fixed pause, would close it. Not blocking — no
  call site I traced has a plausible double-write.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree's
  `scripts/concertino/` (the worktree branched before it was added); I used the main
  checkout's copy. Not a defect in this change, just a note for the orchestrator.
