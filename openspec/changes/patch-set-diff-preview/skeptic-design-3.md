## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/patch-set-preview/spec.md`,
`skeptic-design-1.md`, `skeptic-design-2.md` in full. `git status` is clean except the untracked
`openspec/changes/patch-set-diff-preview/` dir — no code written yet (`git log` HEAD is still
`22de7331` HEL-406, unchanged since round 1/2), so this is still a pure design-soundness review and
every fact round 1/2 already verified against source is still current.

**Primary target of this round's brief — does `panels_select`'s RLS policy actually make
`existsBoundToType` behave as design.md D4 claims? Yes, genuinely confirmed against source:**
- `V36__rls_sharing_aware_tables.sql:143-148`: `ALTER TABLE panels FORCE ROW LEVEL SECURITY;` +
  `CREATE POLICY panels_select ON panels FOR SELECT USING (helio_can_access_dashboard(dashboard_id));`
  — read in full, exact match to design.md's citation.
- `helio_can_access_dashboard` (`V36__...sql:42-86`, read in full): for an authenticated caller
  (`app.current_user_id` set), returns true only when the caller is `dashboards.owner_id` OR has a
  matching row in `resource_permissions` (named grantee) for that dashboard — i.e. exactly "owner or
  sharing grant," as D4 claims.
- `DbContext.withUserContext` (`DbContext.scala:34-51`, read in full): runs on the **app pool**
  (`db`, no BYPASSRLS), `SET LOCAL app.current_user_id` scoped to the transaction. This is a
  genuinely different pool from `withSystemContext`'s privileged/BYPASSRLS pool (lines 53-64).
- Therefore a plain `SELECT COUNT(*) FROM panels WHERE type_id = ...` run inside
  `ctx.withUserContext(user.id.value)`, with no `owner_id` filter in the SQL, is restricted by
  Postgres itself (FORCE RLS + the `panels_select` policy) to rows on dashboards the calling user
  owns or has a grant on — genuinely returns 0 for a panel the caller cannot see, nonzero for one
  they can see as owner OR grantee. Design.md D4's mechanism claim holds.

**Round-1's four content-check fixes — re-verified against current source, not just re-read as
prose, confirmed intact and unregressed:**
- `PanelServiceHelpers.resolvePatch` (`PanelServiceHelpers.scala:21-48`, read in full): blank-title
  check (`trimmedTitle.contains("")`) and cross-type-PATCH check present exactly as design.md D1
  describes.
- `PanelService.update` (`PanelService.scala:433-470`, read in full): `resolvePatch` called first,
  `validateScatterAggregationConflict` second — same control flow design.md D1/D3 cites.
- `PipelineService.updateName` (`PipelineService.scala:153-155`, read in full): `if
  (req.name.trim.isEmpty) ...BadRequest("name must not be empty")` — exact match.
- `DataTypeService.applyUpdate` (`DataTypeService.scala:79-120`, read in full):
  `RequestValidation.MaxExpressionLength` check then `ExpressionEvaluator.validateTolerant` per
  computed field — both confirmed present and pure as cited.
- `DataTypeService.delete` (`DataTypeService.scala:127-141`, read in full): `checkSourceLink` then
  `existsBoundToAnyOwnedPanel` → `Conflict` — confirmed present; see note below on citation order.

**Final AC pass (ticket.md):** all six ACs trace to a concrete artifact —
AC1 (preview route, no writes) → D5/task 3.1/spec "POST /api/patch-sets/preview" requirement;
AC2 (preview/apply parity) → D1/D1a, tasks 2.1/2.2, spec's content-check requirement, tests 6.3/6.4;
AC3 (impact hints) → D4, tasks 2.3/2.3a, tests 6.5;
AC4 (frontend reuse, Accept→apply, nothing written until Accept) → D6, tasks 4/5, tests 6.7/6.8;
AC5 (tests/lint/DESIGN.md) → tasks 5.2/6.9;
AC6 (additive) → D5/D6 + proposal.md's explicit additive-only framing. No AC is uncovered, and no
scope drift beyond the ticket's Scope text was found (D7's "no bespoke diff UI" is a Non-Goal that
matches the ticket's own Out of Scope framing, not an addition).

### Verdict: REFUTE

### Change Requests

1. **Tasks.md 6.5's plan to "directly unit-test `PanelRepository.existsBoundToType`... proving the
   RLS scoping actually narrows results, not just that the method compiles" names no test harness,
   and this exact codebase has already been burned by this exact gap on a structurally identical
   query.** `existsBoundToType` (design.md D4, task 2.3a) is, by design, raw SQL with **no**
   `owner_id`/ACL predicate in its own SQL text — its entire cross-owner-narrowing correctness
   depends on Postgres RLS actually being evaluated under `withUserContext`. I read
   `WorkspaceTeardownServiceSpec.scala:27-40` in full, which documents this exact failure mode for a
   structurally identical situation (`WorkspaceTeardownRepository`'s guard queries, also raw SQL
   with no `owner_id` predicate, safety also depending entirely on RLS under `withUserContext`):
   > "**Real RLS, not the simplified `DbContext(db, db)` pattern most ACL specs use.**
   > ...their entire cross-owner safety comes from Postgres RLS evaluating under `withUserContext`
   > ...A test harness where both the app pool and the privileged pool connect as the `postgres`
   > superuser (BYPASSRLS) would make every guard query see every owner's rows regardless of
   > correctness, and 6.9/6.12 would pass for the wrong reason. This spec mirrors
   > `RlsOwnerTablesSpec`'s dual-pool harness instead: the app pool connects as a real, non-superuser
   > `helio_app_test` role..."

   I confirmed by grep that this "simplified `DbContext(db, db)`" pattern (superuser for both pools,
   RLS silently bypassed — Postgres always bypasses row security for superusers regardless of FORCE
   RLS) is the **dominant** pattern in this codebase: 53 test files use `new DbContext(db, db)`,
   versus only 11 that build the real non-superuser `helio_app_test` dual-pool harness (grep for
   `helio_app_test|SET ROLE` across `backend/src/test/scala`), and those 11 are exactly the
   dedicated RLS-verification specs (`RlsOwnerTablesSpec`, `RlsSharingAwareTablesSpec`,
   `RlsPrivilegedDmlSpec`, `PipelineSharingAclSpec`, `WorkspaceTeardownServiceSpec`, etc.), not the
   ordinary service/repository specs. `DataTypeRepositorySpec.scala:35` (housing the existing
   `existsBoundToAnyOwnedPanel` test 2.3a's sibling reuses) itself uses `new DbContext(db, db)` —
   and gets away with it only because that query's SQL has an explicit `owner_id = ...` predicate
   baked in, so its narrowing doesn't depend on RLS at all. `existsBoundToType` has no such
   predicate — by design, per round 2's own fix.

   Nothing in design.md or tasks.md names the required harness for 6.5's RLS-narrowing assertion.
   Given `PatchSetPreviewServiceSpec.scala` (task 6.1) is the only backend service spec this ticket
   creates, and its OTHER assertions (before/after diff correctness, content-check rejections) need
   no real RLS enforcement to pass, an implementer following tasks.md literally would very plausibly
   place 6.5's test in that same spec using the same convenient, dominant `DbContext(db, db)`
   pattern. Under that harness, the query no longer bypasses at "0 vs nonzero" as expected — a
   superuser connection sees every panel bound to the type regardless of dashboard visibility, so
   the specific assertion 6.5 asks for ("false ... when a bound panel's dashboard is NOT visible to
   the caller") would fail. The dangerous failure mode is not that this goes unnoticed (a superuser
   harness makes the assertion fail loudly) — it's the most likely "fix" an implementer reaches for
   under time pressure: adding an explicit `owner_id`/ACL predicate directly into
   `existsBoundToType`'s own SQL to make the test pass under any harness. That would silently
   collapse `existsBoundToType` back into `existsBoundToAnyOwnedPanel`'s owner-only behavior —
   defeating the entire cross-owner-shared-panel detection round 2's REFUTE required, without
   tripping any test, since the "fixed" query would still pass 6.5's assertions (now trivially, by
   construction, rather than by genuine RLS enforcement).

   **Required fix:** tasks.md 6.5 (and/or design.md D4) must explicitly specify that
   `existsBoundToType`'s RLS-narrowing test uses the real, non-superuser `helio_app_test` dual-pool
   harness — mirroring `RlsSharingAwareTablesSpec.scala`/`WorkspaceTeardownServiceSpec.scala`'s
   established pattern, not the simplified `DbContext(db, db)` pattern the rest of
   `PatchSetPreviewServiceSpec.scala` may reasonably use for its non-RLS-dependent assertions — and
   should cite `WorkspaceTeardownServiceSpec.scala`'s own doc comment as the precedent, since this
   codebase has hit and already documented this exact trap once before.

### Non-blocking notes

- Design.md D1/D1a and tasks.md 2.2 describe the two dataType-`delete` content checks in the order
  "(a) `existsBoundToAnyOwnedPanel`, (b) source-link (`checkSourceLink`)" — the real
  `DataTypeService.delete` (`DataTypeService.scala:127-141`, read in full) evaluates them in the
  opposite order: `checkSourceLink` first (line 131), `existsBoundToAnyOwnedPanel` second (line
  134), so a DataType failing both would surface the source-link `Conflict` message from real
  `apply`, not the panel-bound one. I traced whether this ordering mismatch is actually reachable:
  it is not, under current write paths. `PanelService.rejectCompanionBinding` /
  `PatchSetApplyResolvers`'s own companion-binding check (`PatchSetApplyResolvers.scala:191-201`,
  mirroring it) both reject any attempt to bind a panel to a DataType with `sourceId` defined
  ("Panels can only bind to pipeline-output data types") — so a DataType can never simultaneously
  have `sourceId` defined (triggering `checkSourceLink`) and a bound panel (triggering
  `existsBoundToAnyOwnedPanel`) under any currently-governed write path; the two conditions are
  structurally mutually exclusive. Worth a one-line comment in design.md D1a noting the checks are
  listed out of real execution order but that this doesn't matter given the mutual-exclusivity
  invariant — purely for a future reader's clarity, not blocking.
