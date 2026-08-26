## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-review of HEL-477 at `341692e3`, diffed against `main`. Round 1's REFUTE
(`skeptic-final-1.md`) is treated as prior art, but every conclusion below is
re-derived from the files/commands named — not from `evaluation-2.md`,
`files-modified.md`, or the executor's commit message.

### What I verified (with evidence)

**Gate — backend-test.** Diff touches `backend/**` and `openspec/**`;
`git diff main...HEAD --name-only | grep -c '^frontend/'` → `0`, so lint/format/
npm-test/build do not apply and the UI/design-judgment section is legitimately
skipped (no UI surface exists to judge). Re-run fresh by me:

```
cd backend && sbt -batch compile test
[info] Run completed in 3 minutes, 7 seconds.
[info] Total number of tests run: 3436
[info] Suites: completed 219, aborted 0
[info] Tests: succeeded 3436, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
EXIT=0
```

3436 vs. round 1's 3434 — exactly the two new tests, both present in the run log
(lines 3670-3672):
`- should write exactly one pipeline.step.duplicate audit row on POST /api/pipeline-steps/:id/duplicate`
and `- should write exactly one pipeline.step.reorder audit row (not one per step) on PUT /api/pipelines/:id/steps/order`.
Working tree is clean (`git status --porcelain` empty), so the tested tree is the
committed tree.

**Change Request 1 — `duplicateStep` instrumented.** `PipelineService.scala` (in the
`insertAtInternal(...).map { step => ... }` success branch, ~:786-800): emits
`pipeline.step.duplicate`, `resourceType = "pipeline_step"`,
`resourceId = Some(step.id.value)` (the **new** step, as requested),
`metadata = {"sourceStepId": <original stepId>}`. Fires only inside `.map` on the
successful insert; failures route to the sibling `.recover { classifyDbError }`, so
no row on error. Uses the existing private `audit(...)` helper, which retains its
`if (auditService != null)` guard — the helper was widened with a defaulted
`metadata: JsValue = JsObject.empty` param, so all pre-existing call sites are
behaviorally unchanged.

**Change Request 2 — `reorderSteps` instrumented.** Same file, in
`reorderInternal(...).map { steps => ... }` (~:728-742): one
`pipeline.step.reorder` row **per call**, `resourceType = "pipeline"`,
`resourceId = Some(pipelineId.value)`, `metadata.stepIds` = the resulting ordered
step ids. This is exactly Decision 7's one-row-per-actor-initiated-call principle,
not one row per step. Success-branch only, same `.recover` structure.

**Change Request 4 — integration coverage is real, not vacuous.**
`AuditMutationInstrumentationSpec.scala:645-711`. Both tests drive the real route
tree (`routesFor()` → real `ApiRoutes` + real embedded-Postgres
`AuditEventRepository`, `:73-96/:145-160`), building a real data source → pipeline →
step(s) over HTTP first. The assertions bind to values only obtainable from the
response:
- duplicate: filters on `resourceId.contains(newStepId)` (the *new* id from the 201
  body), asserts `size 1`, `resourceType == "pipeline_step"`, and
  `metadata.fields("sourceStepId") == JsString(stepId)` — so a wrong-id or
  empty-metadata implementation fails.
- reorder: creates two steps and reorders them **backwards**
  (`Seq(stepId2, stepId1)`), then asserts `metadata.fields("stepIds") ==
  JsArray(JsString(stepId2), JsString(stepId1))`. An implementation that recorded
  creation order, or omitted metadata, would fail. `size 1` on a per-pipeline filter
  is the "not one per step" assertion.
Both call `cleanDb()`, which correctly does **not** touch `audit_events` (HEL-471
append-only trigger); per-test scoping is by action + resource id, which is unique
per test here.

**Change Request 3 — the artifacts were actually corrected, not just the code.**
I read the diff of both docs rather than trusting the commit message:
- `route-audit-enumeration.md`: both rows moved out of "Tracked gaps" into the
  in-scope table with their real actions and metadata shapes; the gaps section now
  contains only items 1-3 (the two `refresh` paths + `WorkspaceTeardownService.teardown`)
  plus an explicit "Resolved (skeptic-final-1 round 1)" note. As a bonus correction,
  the reorder route path was fixed from the previously-wrong
  `PUT /api/pipelines/:id/steps/reorder` to the actual `.../steps/order` — I verified
  against `PipelineStepRoutes.scala:36-40` (`path("order")`) that `order` is correct.
- `design.md` Decision 9: two new bullets document both call sites, their action
  names, resource ids, metadata, and explicitly record that the original
  "walked every directive" enumeration was inaccurate without them. The stale claim
  round 1 flagged is now retracted in place rather than left standing.
- `files-modified.md` updated for both the service and the spec.

**Independent re-check that nothing else in the ticket's named scope is missing.**
I did not rely on the enumeration doc. I re-listed every mutating directive under
`api/routes/` myself (85 `post`/`put`/`patch`/`delete` occurrences, 38 files) and
walked each in-scope route file to its service method:
- `PipelineStepRoutes.scala` — all 5 mutating directives (`POST steps`,
  `PUT steps/order`, `PATCH`, `DELETE`, `POST duplicate`) now map to
  `pipeline.step.{create,reorder,update,delete,duplicate}`. This file was the
  round-1 gap and is now complete.
- `PipelineRoutes.scala` (`post`/`patch`/`delete` → create/updateName/delete),
  `PipelineRunSubmitRoutes` (run.submit), `PipelineScheduleRoutes` (upsert/delete),
  `DataTypeRoutes` (`PATCH`/`DELETE` → data_type.update/delete; no create route
  exists), `DashboardRoutes` (create/duplicate/update×2/delete),
  `PanelRoutes` (batchUpdate/batchCreate/create/delete/update/duplicate),
  `DataSourceRoutes` (update/delete + all create variants),
  `SourceRoutes` (createSql/createRest), `ApiTokenRoutes` (create/revoke),
  `AuthRoutes` (register/login/logout) — every one lands on a method that emits an
  action in the shipped verb namespace.
- Shipped action namespace (grepped from `services/`): `auth.login`,
  `auth.login.challenged`, `auth.login.failed`, `auth.logout`, `auth.register`,
  `auth.mfa.{enable,disable,backup_codes.regenerate}`, `dashboard.{create,update,
  delete,duplicate,import,contents.replace}`, `data_source.{create,update,delete}`,
  `data_type.{update,delete}`, `image_upload.create`, `panel.{create,update,delete,
  duplicate,batch_create,batch_update}`, `pipeline.{create,update,delete}`,
  `pipeline.run.submit`, `pipeline.schedule.{upsert,delete}`,
  `pipeline.step.{create,update,delete,reorder,duplicate}`, `token.{create,revoke}`.
  Stable, consistently namespaced, and covering every scope bullet in `ticket.md`.
- The only remaining un-instrumented mutations are the three the enumeration
  honestly declares out of scope (`DataSourceService.refresh`,
  `SourceService.refresh`, `WorkspaceTeardownService.teardown`) — none of which is a
  create/update/delete of a named resource type. I independently agree, unchanged
  from round 1.

**Round 1's other verified findings still hold at this commit** (I re-checked the
diff for regressions rather than re-deriving in full): prod wiring of `auditService`
into all mutating services via `ApiRoutes`/`Main`; AC 2 secret-free
`auth.login.failed` metadata; AC 3 failing-audit-stub test asserting `POST
/api/dashboards` still returns 201; Decision 10's `deleteInternal` rollback split and
its non-vacuous regression test. `341692e3` touches only `PipelineService.scala`, the
spec, and docs — nothing in those paths.

### Verdict: CONFIRM

All four round-1 Change Requests are addressed in code, tests, and artifacts, with
the artifacts corrected in place rather than left contradicting the code. All four
acceptance criteria trace to real evidence, the sole applicable gate is green on my
own fresh run, and my independent route walk found no further in-scope gap.

### Non-blocking notes

- **Carried forward from round 1, still open and still worth follow-up tickets:**
  (a) `WorkspaceTeardownService.teardown` has zero audit trail and is the
  highest-blast-radius mutation in the route tree — the most valuable next increment;
  the two `refresh` gaps can ride along. (b) OAuth first-time signup emits no
  `auth.register` (`AuthService.completeOAuth` audits only the login outcome, because
  `upsertGoogleUser` returns no created/existing flag) — fixing it needs a repository
  signature change beyond this ticket's shape.
- **`eventuallyAuditRows` can still under-detect a duplicate row**
  (`AuditMutationInstrumentationSpec.scala:188-196`): it stops at the first match, so
  `should have size 1` passes as soon as one row lands and a spurious second row
  written milliseconds later would be missed. This now also applies to the two new
  tests. Not blocking — neither new call site has a plausible double-write path (both
  sit in a single `.map` on a single repo call) — but a short settle-and-recount
  would make the "exactly one row" AC as strong as it reads.
- `scripts/concertino/next-report-number.sh` still does not exist inside this
  worktree (it branched before the script was added); I used the main checkout's copy,
  which returned `READY number=2`. Not a defect in this change.
