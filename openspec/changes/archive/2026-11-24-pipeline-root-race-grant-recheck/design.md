## Context

HEL-1652 moved editor root writes onto the privileged connection (`ctx.withSystemContext`, RLS bypassed) after a
service-layer owner-or-editor check. Every editor-reachable privileged pipeline write follows that shape; only run
admission (`PipelineRunRepository.insertGranteeRunIfUnderOwnerCap` -> `submitterMayRunAction`) re-checks the grant
inside its own transaction. Full enumeration (main 737adb352):
`.concertino/runs/HEL-1707/evidence/editor-privileged-write-enumeration.md` (main checkout).

Owner rulings (escalations answered 2026-11-24, recorded via `concertino answer --channel=chat`):
- Q1 = A: re-check only root add/remove, draft save (incl. the undo restore that calls `saveCore`), step writes.
  Output create, insight refresh and dashboard-editor writes are follow-up HEL-1882 (v0.10), out of scope.
- Q2 = fix here, reading R2: Output delete and patch-set undo of an Output create require creator AND current
  owner-or-editor access. Nobody gains delete rights; PATCH unchanged.
- Q3: a plain read of `resource_permissions` after the pipeline-row lock; no `FOR SHARE`.

Facts the design rests on (verified on the tree):
- `PipelineRootRepository.add` reads `pipelines.name` with `.result.head` (NoSuchElementException -> unrecovered in
  `PipelineRootWrites.attachRoot` -> 500) and discards the Boolean of `locks.lockPipelines(LockSite.RootAdd, ...)`
  (`false` = the row is gone; the insert would then fail the FK).
- `PipelineDefinitionLocks.lockPipelines` returns `true` only when every id still exists (V137 count).
- Every step/root/draft/Output-delete write already takes `lockPipelines` (lock (3)) inside one transaction.
- V129 grants `SELECT, UPDATE ON panels TO helio_privileged`; `hel1498_lock_panels` (SECURITY DEFINER, owned by
  `helio_privileged`) needs it for `FOR UPDATE` on the root-remove and Output-delete paths. V137 re-owns
  `hel1629_lock_pipelines` to `helio_privileged`, so it executes it as owner; root add/remove call it. Both are real
  grants the code relies on; no migration.

## Goals / Non-Goals

Goals: item 1 (404, never 500); item 2 for the ruled set; Output delete R2; item 3 and 4 guards.
Non-goals: Output create, insight refresh, dashboard-editor writes (HEL-1882); any pipeline-run write path (HEL-1541);
`FOR SHARE` on grant rows; any API shape change; any migration.

## Decisions

### D1. One shared in-transaction predicate
Add a single DBIO predicate (e.g. `PipelineWriteAccess.currentAction(pipelineId, userId): DBIO[Access]` returning
`Owner | Editor | Viewer | NoAccess | PipelineGone`) in `infrastructure/persistence/pipelines`, reading
`pipelines.owner_id` and the caller's `resource_permissions` row for `resource_type = 'pipeline'` with explicit
predicates (never RLS / GUC; runs on the privileged connection). It is the same rule as `submitterMayRunAction`
(owner, or a row with `role = 'editor'`); the run path is NOT changed to use it (HEL-1541 owns those files), but the
predicate's scaladoc names it as the same rule. Viewer vs none is distinguished so the refusal can reproduce the
service check's `403`/`404`.

### D2. Where the re-check sits (production-reachable writers only)
Immediately after the existing `lockPipelines` call (lock (3)) in each write transaction, before any write. The
re-checked writers are exactly the ones an editor request reaches in production (verified: zero callers under
`backend/src/main/scala` for `PipelineStepRepository.insertInternal`, `insertAtInternal`, `reorderInternal`; those
three are NOT changed):
- `PipelineRootRepository.add` (after `lockPipelines(RootAdd)`); `PipelineRootRepository.removeRoot` via
  `PipelineStepRepository.removeRootCascadeAction` (after `lockPipelines(RootRemove)`).
- `DraftSaveTransaction.run` right after `abortIf(!locked, ...)` (actor already in scope; `DraftRestore` goes through
  `saveCore`, so the undo restore is covered).
- Step writes: `attachTailInternal` and `spliceInsertReportingInternal` (step create; `spliceInsertAtInternal`, used by
  duplicate, delegates to the latter), `updateInternal`, `deleteInternal` (inside EACH attempt of
  `deleteAttemptAction`, after its lock; a refusal is a final answer, never retried), `reorderTrunkInternal`.
The enumeration evidence file is corrected to match (the three uncalled methods are listed as unreachable).

At the step sites the existing `lockPipelines` Boolean stays ignored exactly as today (no new lock-result handling is
added there). The predicate itself returns `PipelineGone` when the pipeline row is absent; at every re-checked site that
case maps to the same body as "no grant" for that route (table below), so it is one code path, exercised by the
revoke tests.

#### Refusal mapping (must equal what the route's own pre-check answers today)

| Route | Viewer grant left | No grant / pipeline gone |
|---|---|---|
| POST /api/pipelines/:id/roots | 403 `Forbidden` | 404 `Pipeline not found: <id>` |
| DELETE /api/pipelines/:id/roots/:rootId | 403 `Forbidden` | 404 `Pipeline not found: <id>` |
| POST /api/pipelines/:id/draft/save (and undo restore) | 403 `Forbidden()` | 404 `Pipeline not found: <id>` |
| POST /api/pipelines/:id/steps (create) | 403 `Forbidden` | 404 `Pipeline not found: <id>` (`PipelineStepWriteChecks.scala:94`) |
| PUT /api/pipelines/:id/steps/order (reorder) | 403 `Forbidden` | 404 `Pipeline not found: <id>` (`PipelineStepWrites.scala:100`) |
| PATCH /api/pipeline-steps/:id (update) | 403 `Forbidden` | 404 `Pipeline step not found: <id>` |
| DELETE /api/pipeline-steps/:id (delete) | 403 `Forbidden` | 404 `Pipeline step not found: <id>` |
| POST /api/pipeline-steps/:id/duplicate | 403 `Forbidden` | 404 `Pipeline step not found: <id>` |
| DELETE /api/outputs/:id | 404 `Output not found` | 404 `Output not found` |
| patch-set undo of an Output create | NotFound `Output not found` | NotFound `Output not found` |

The executor confirms each existing body/status from the tree (the exact `Forbidden` message per route) and asserts the
exact body in the tests. The typed refusal (e.g. `PipelineWriteAccessRevoked(access)`) MUST be matched in a `.recover`
placed BEFORE any generic handler (`classifyDbError` etc.). `PipelineStepWrites.deleteStep` and `OutputService.delete`
have no `.recover` today: they gain one that maps ONLY the typed refusal (and, for root add, `PipelineGone`); every
other failure keeps propagating as today.

### D3. The acting user is a required parameter, never a default
Repo methods take `actingUserId: String = ""`, which at every production call site is the PIPELINE OWNER (for the cycle
guard), so reusing it for the re-check would always pass. The re-check MUST NOT use it. Each re-checked method gets a
new required parameter carrying the acting `AuthenticatedUser` (no default value), so every caller must supply it at
compile time. Every production caller of the re-checked methods has the acting user in hand (skeptic-verified), so no
"trusted/system" variant is introduced; if the executor finds a caller without one, that is a stop-and-report, not a
silent bypass. Test call sites are updated mechanically. `files-modified.md` lists every production call site.

### D4. Item 1: 404 for a pipeline deleted mid-request (root add only)
In `PipelineRootRepository.add`, read the name with `.headOption`; `None` aborts with a typed `PipelineGone`. After
`lockPipelines(RootAdd)`, a `false` result aborts with `PipelineGone` BEFORE the grant re-check runs.
`PipelineRootWrites.attachRoot` maps `PipelineGone` to `ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")`
in a `.recover` before any generic handler. Nothing is written. The FK violation (`23503`) is never the signal.

Which check detects the gone pipeline, and the mutation evidence:
- 1(a) deleted before the name read: detector = `.headOption` None. Mutation: restore `.result.head` -> 500. Red.
- 1(b) deleted after the name read, before the lock: TWO independent detectors (the lock Boolean, then the D1
  predicate's `PipelineGone`). This is defence in depth, stated as such. Mutation evidence: removing the Boolean check
  alone stays GREEN (the predicate catches it) and is recorded as such; removing the Boolean check AND mapping the
  predicate's `PipelineGone` to "permitted" turns it RED (the insert fails the FK -> 500). Additionally, a
  repository-level test with the grant re-check disabled by a test-only seam is NOT added (no production seam for it);
  the combined mutation is the evidence. On main 737adb352 the test is red (500).

### D5. Output delete and undo (R2)
`OutputService.delete` keeps its creator check (`output.ownerId == user.id`, 404 otherwise) and
`OutputRepository.deleteWithPanelsInternal` gains the D1 re-check for the caller after `lockPipelines(OutputDelete)`:
`Owner`/`Editor` proceed; anything else aborts and the service answers `404 Output not found`, nothing deleted.
`PatchSetUndoService.deleteCreatedOutput` passes the user to `deleteIfUnboundInternal`, which applies the same check
after its `lockPipelines(OutputDelete)`; refusal -> `ServiceError.NotFound("Output not found")`. When the Output row is
already gone inside the transaction (its pipeline id reads `None`), behaviour stays exactly as today (no predicate,
nothing to delete). One site covers both the non-race downgrade and the race.

### D6. Deterministic race tests (service level)
No sleeps. `ApiRoutes` builds its repositories with production `PipelineDefinitionLocks.Enforced`, so race tests run at
the SERVICE level with repositories constructed on a test-only `PipelineDefinitionLocks` subclass (`DraftSaveHarness`
already accepts injected locks; root/step/Output tests build their own repos/services the same way). The override of
`lockPipelines` (and, for 1(a), `choose` at `LockSite.RootAddSourceShare`) returns a DBIO that FIRST runs the side
effect as a DBIO step executed at that point of the chain (a `SimpleDBIO`, or `DBIO.successful(()).flatMap(_ => DBIO.from(...))` so the Future is created only when the step runs -- a bare `DBIO.from(f)` is eager; the step commits on a
SEPARATE connection: delete the pipeline; delete or downgrade the grant), then the real lock. Building the side effect
eagerly in the by-name argument would run it before the transaction starts and is NOT acceptable. Under READ COMMITTED
the next statement of the write transaction sees that commit. For draft save the existing `DraftSaveHooks` points may
be used instead. Each red test must be red on main 737adb352 for the stated reason (500 / write landed) and green
after; each fix has a mutation that turns its test red again, recorded with output.

### D7. Guards (items 3 and 4)
Item 3 tests go in the NOBYPASSRLS route fixture (`DraftSaveApiFixture`, alongside HEL-1652's cases in
`DraftSaveRlsSpec` or a new spec on the same fixture). They pass on main and are labelled GUARD; each is shown failable
by a named mutation: 3.1 drop `findByIdOwned` in `attachRoot` (attach the id unchecked); 3.2 defeat BOTH the phase-1
membership check (`roots.exists(_._1 == rootId)`, `PipelineRootWrites.scala:152`) AND the `pipelineId` scoping of
`removeAction`/`removeRootCascadeAction` (removing only the delete scoping leaves the guard green, recorded).
Item 4 extends `PipelineRootWriteGrantsSpec` (ProductTelemetryDbHarness, migrations only):
`has_table_privilege('helio_privileged','panels','UPDATE')`, `has_function_privilege('helio_privileged',
'hel1629_lock_pipelines(text[],text[])','EXECUTE')`, and the function's `proowner` resolves to `helio_privileged`
(EXECUTE is true by ownership alone). All labelled GUARD, each shown failable by an uncommitted mutation run (e.g. a
harness-local `REVOKE UPDATE ON panels FROM helio_privileged` / `ALTER FUNCTION ... OWNER TO` another role; if the harness role may not do that, mutate the assertion target instead, e.g. a table/privilege it does not hold, and say so).

Step update: its lock helper `lockPipelineOfStep` does not expose the pipeline id; restructure so the re-check knows it, and when the step is already gone keep today's `Pipeline step not found` answer. Race-only outcome changes to state in the PR body: reorder and step create on a pipeline deleted mid-request answer the table's 404 (today 422 / a database-error response).

## Risks / Trade-offs

- A revoke committed after the in-transaction read still lets that one write land (no `FOR SHARE`, Q3). Accepted.
- An extra indexed read per write; negligible.
- D3 touches every re-checked writer's call sites (production and tests); compile errors are the safety net.
- Visible change outside the race (R2): a downgraded/revoked Output creator can no longer delete or undo-delete it.

## Gate-Chain Implications Checklist

Not applicable: this change touches no `.husky/**` file and no script `.husky/pre-commit` invokes.
