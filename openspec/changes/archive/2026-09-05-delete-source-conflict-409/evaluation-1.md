## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `ee84786b` (the only HEL-987 commit; the other commits in `main..HEAD`
— `431d86de`, `cdb6e06a`, `4b7acbbe` — are base noise from an unmerged main, not this
ticket's scope, and were excluded from review).

### Phase 1: Spec Review — FAIL

Design-gate constraints (all seven checked against the diff):

1. Root cause = P0001, not FK — PASS. `DataSourceService.isZeroRootViolation` matches
   SQLSTATE `P0001` plus the `HEL-913` / `zero roots` signature; no FK/`23503` handling anywhere.
2. Sole-root-only scope — PASS. `DataSourceRepository.soleRootDependentPipelines`
   (`DataSourceRepository.scala:227-238`) is a new query with
   `GROUP BY p.id, p.name HAVING count(*) = 1 AND bool_and(r.data_source_id = <id>)`; it counts
   ALL of the pipeline's roots, so a multi-root pipeline is excluded.
   `WorkspaceTeardownRepository.sourceDependentPipelineConflict` is not referenced. The
   multi-root 204 control test exists and passes.
3. Conflict carrier = wrapper, not `ServiceError.Conflict`, not a packed string — PASS.
   `DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err: ServiceError)`
   mirrors `AuthoringError`; four discrete fields.
4. Field-asserted 409 body — PASS. `DataSourceRoutesSpec` asserts `resourceKind`,
   `resourceId`, `resourceName`, `reason`, `message` individually.
5. Task 1.2 red evidence real — PASS. `evidence/red-before-fix.txt` records the actual
   failure line `500 Internal Server Error was not equal to 409 Conflict
   (DataSourceRoutesSpec.scala:859)` with the surrounding 5-test run summary — a real captured
   run, not an assertion that it was red. The two controls are shown already-green pre-fix,
   which is the correct expectation.
6. No migration — PASS. `git show --stat ee84786b` contains nothing under
   `backend/src/main/resources/db/migration/`.
7. Pre-check before `deleteFileF` — PASS. `soleRootDependentPipelines` is called in the
   `Some(source)` branch and `deleteFileF` is constructed only inside the `case _ =>`
   (non-blocking) arm. The 409 test also asserts the source still lists afterwards.

Issue (blocking):

- **The implemented 409 body contradicts this change's own spec delta.**
  `specs/datasource-edit-delete/spec.md` states `resourceKind` is `"data_source"` and
  `resourceId`/`resourceName` identify **the source** (repeated in the first scenario:
  "whose `resourceId` is the source id"). The implementation
  (`DataSourceService.scala:632`) sets `resourceKind = "pipeline"` with the **pipeline's**
  id and name. One of the two must change; they cannot both ship. The teardown shape the
  design says this is "consistent with" uses `resourceKind = "data_source"`
  (`WorkspaceTeardownRepository.scala:125`, whose comment states `resourceKind` is
  `"data_source"`, with the dependent pipeline named in `reason`) — so the spec delta is
  the side that matches the stated precedent, and the code is the side that diverged. Either
  way this is unresolved and a client written against the spec delta gets a different
  contract than the server sends.

Other Phase 1 items: all tasks marked done and matching the implementation; no AC silently
reinterpreted; no scope creep in this commit; callers of the changed signature all updated
(`PatchSetApplyForward`, `PatchSetApplyRollback`, `PatchSetUndoService`, plus the
`.map(_ => ())`-discarding `PipelineProposalService` sites which need no change).

### Phase 2: Code Review — FAIL

Gates run fresh by me in `WORKTREE_PATH` (backend-only change set):

- `cd backend && sbt -batch test` → **green**: 3836 tests, 253 suites, 0 failed
  (`[success] Total time: 350 s`). No frontend files changed in this commit, so the
  `frontend/**` gates do not apply.

Code-quality: no inline fully-qualified names; imports added at the top of
`DataSourceService.scala`; comments reference the design decision they implement rather than
restating the code; no dead code, no TODO/FIXME, no `any`-equivalent escape hatches; the
client body carries no SQLSTATE/driver text and the underlying cause is logged once at WARN
with the source id.

Issue (blocking):

1. **Race-path conflict carries a source id in a pipeline-typed field.**
   `DataSourceService.soleRootConflict` (`DataSourceService.scala:620-633`) is called from the
   `PSQLException` recovery arm with `blocking = Vector.empty`; it then emits
   `resourceKind = "pipeline"`, `resourceId = sourceId.value`, `resourceName = "unknown"`.
   A client that reads `resourceId` as the identifier of the named `resourceKind` is handed
   the data source's id labelled as a pipeline — a wrong, actionable value, not merely a
   vague one. The comment explains why the *reason text* degrades on this path but says
   nothing about the identifier substitution. Fix alongside issue 1 above (whichever
   `resourceKind` convention wins, the race path must emit an identifier that actually is
   of that kind, or an explicitly empty one).

### Phase 3: UI Review — N/A

No trigger matched: this commit touches only `backend/src/main/scala/**`,
`backend/src/test/scala/**` and this change's own `openspec/changes/` dir. No `frontend/**`,
no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`.

### Overall: FAIL

### Change Requests

1. Reconcile the 409 body's `resourceKind`/`resourceId`/`resourceName` semantics between
   `openspec/changes/delete-source-conflict-409/specs/datasource-edit-delete/spec.md`
   (says `data_source` + the source's id/name) and
   `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:632`
   (emits `"pipeline"` + the pipeline's id/name). Pick one and make both sides say it.
   The teardown precedent the design cites (`WorkspaceTeardownRepository.scala:125` and its
   comment at :136) uses `resourceKind = "data_source"` with the dependent pipeline named in
   `reason`, so aligning the code to the spec delta is the lower-risk direction; if the
   pipeline-identifying shape is deliberate instead, update the spec delta's requirement text
   and its first scenario, and say in `design.md` why this route departs from the teardown
   convention it is documented as matching. Update the field-level assertions in
   `DataSourceRoutesSpec` to match whichever is chosen.
2. `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:620-633` — on
   the race path (`blocking.isEmpty`), stop substituting `sourceId.value` into `resourceId`
   while `resourceKind` claims `"pipeline"`. Emit an identifier consistent with the
   `resourceKind` decided in CR1 (or an empty string with the degradation documented in the
   scaladoc, as the `reason` fallback already is).

### Non-blocking Suggestions

- `soleRootDependentPipelines` returns `Vector[(String, String)]`; a small
  `case class BlockingPipeline(id: String, name: String)` would remove the positional
  `case (id, name)` destructuring in `soleRootConflict` and make the tuple order
  self-documenting at the repository boundary.
- There is a stray double blank line after `soleRootConflict` in `DataSourceService.scala`
  before the `refresh` scaladoc.
