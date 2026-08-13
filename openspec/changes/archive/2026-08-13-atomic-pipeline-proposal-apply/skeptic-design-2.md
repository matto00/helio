## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-apply/spec.md`, and round 1's `skeptic-design-1.md` in full
  (the latter as a claim to re-check, not as ground truth).
- Confirmed the round-1 finding's core ask (route deletes through
  `DataTypeService.delete`/`DataSourceService.delete`/`PipelineService.delete`, never a raw
  repository delete) **is** now reflected in `design.md` D5 (lines 69-84) and `tasks.md` 2.1/2.7 —
  matches ticket.md AC "no direct DB writes."
- Re-read `DataTypeService.delete`/`checkSourceLink`
  (`backend/src/main/scala/com/helio/services/DataTypeService.scala:127-165`) again in full to
  verify the reordering claim itself, not just that a reordering happened.
- Read `DataSourceService.delete` (`backend/src/main/scala/com/helio/services/DataSourceService.scala:499-516`):
  confirms it ends in `dataSourceRepo.delete(source.id, user)` — a single `DELETE` — with no
  intervening step that could delay the FK action.
- Read the FK itself: `backend/src/main/resources/db/migration/V4__data_sources_and_types.sql:12`
  — `data_types.source_id ... REFERENCES data_sources(id) ON DELETE SET NULL`. Postgres executes
  `ON DELETE SET NULL` synchronously as part of the `DELETE` statement (not a deferred trigger),
  so the companion `DataType` row's `source_id` reads `NULL` **immediately** after
  `DataSourceService.delete` returns — visible to any subsequent query, in or out of a transaction.
- Read `DataTypeRepository.findBySourceId`
  (`backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala:65-70`):
  `table.filter(r => r.sourceId === id.value && r.ownerId === ownerUuid).result` — a literal
  `WHERE source_id = ?` query. Confirms it cannot locate a row whose `source_id` has already been
  nulled by the FK action above.
- Read `CreateSourceEnvelope.build` (`backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala:29-64`)
  and `CreateSourceResponse` (`backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala:160-164`):
  on success, `SourceService.createSql`/`createRest` already return the companion `DataType`'s id
  in `CreateSourceResponse.dataType`. `DataSourceService.createStatic`
  (`DataSourceService.scala:90-133`) does not — it returns a bare `DataSource`, so for the `static`
  inline branch the companion `DataType` id genuinely isn't known to the caller without a
  `findBySourceId` lookup.
- Read `PipelineService.delete` (`PipelineService.scala:151-159`) and `PipelineRunService.submit`/
  `runPipeline` (`PipelineRunService.scala:83-129`) — both match what `design.md` D5/D6 and
  `tasks.md` 2.6/2.7 assume; no new discrepancy found here.
- Read `specs/pipeline-proposal-apply/spec.md`'s "Full rollback on any mid-apply failure"
  requirement and its scenario — it commits to "Resource counts (sources, pipelines, pipeline
  steps, data types) SHALL be unchanged from immediately before the call," which is exactly the
  invariant the bug below breaks, and is exactly what `tasks.md` 4.4's planned test asserts.

### Verdict: REFUTE

### Change Requests

1. **Round-1's fix was applied to the wrong half of the problem: the delete now correctly routes
   through `DataTypeService.delete` (guard satisfied), but the companion-DataType *lookup* it
   depends on is now sequenced to run after the very delete that erases the only column it queries
   by — so the rollback silently no-ops and leaves the companion DataType orphaned, exactly the
   defect class D5's own Context section (lines 9-15) was written to prevent.**

   `design.md` D5 step 3 (lines 80-84) and `tasks.md` 2.7 (lines 36-39) both read, verbatim:
   > "delete the source first (`DataSourceService.delete` ... nulls the companion DataType's
   > `sourceId`), then find ... its now-source-less companion DataType(s) via
   > `dataTypeRepo.findBySourceId` ... + `DataTypeService.delete`."

   This is temporally self-defeating. `DataSourceService.delete` ends in a plain
   `dataSourceRepo.delete` (`DataSourceService.scala:515`), which fires the `data_types.source_id
   ON DELETE SET NULL` FK (`V4__data_sources_and_types.sql:12`) **synchronously, as part of that
   DELETE** — Postgres does not defer `ON DELETE SET NULL`. By the time step 3's second half runs,
   the companion `DataType.source_id` is already `NULL`. `dataTypeRepo.findBySourceId` is a literal
   `WHERE source_id = ?` filter (`DataTypeRepository.scala:68`), so querying it with the
   already-deleted source's id returns an **empty** `Vector` — no row matches anymore. The
   "find and delete each" loop over that empty result iterates zero times, and the companion
   DataType is never deleted.

   Net effect: every rollback of an inline-source proposal (the scenario `tasks.md` 4.4 and
   `spec.md`'s "A run failure rolls back the pipeline, its output type, and an inline source"
   scenario are built around) leaves exactly the orphaned, panel-bindable DataType behind that D5's
   Context section (lines 9-15, "A naive rollback ... leaves orphaned, panel-bindable DataTypes
   behind — the opposite of 'no partially-created resources'") explicitly calls out as the thing
   this design exists to prevent. It also directly falsifies `spec.md`'s own SHALL-text ("Resource
   counts ... SHALL be unchanged") and would fail `tasks.md` 4.4's count-based test as written —
   this is not a style nit, it's a design that cannot pass its own planned acceptance test.

   **Required revision:** capture the companion DataType's id *before* the source delete removes
   the only way to find it, then delete by id *after* the source delete (so `checkSourceLink` still
   passes — that part of round 1's fix was correct and should stay). Concretely, in D5 step 3 and
   tasks.md 2.7:
   - For the `rest_api`/`sql` inline branches: the id is already known for free —
     `SourceService.createSql`/`createRest` return `CreateSourceResponse.dataType` (populated
     on success; verified `CreateSourceEnvelope.build`, `CreateSourceEnvelope.scala:57-63`) — carry
     that id through the apply call's local rollback state, no query needed at all.
   - For the `static` inline branch: `DataSourceService.createStatic` returns a bare `DataSource`
     with no DataType id (`DataSourceService.scala:90`), so call `dataTypeRepo.findBySourceId`
     **before** `DataSourceService.delete` (either right after creation, to capture the id
     alongside the other created-resource ids, or at the top of the rollback step, but in either
     case strictly prior to the source delete) — then delete the source, then delete the
     already-captured companion DataType id(s) via `DataTypeService.delete`.
   - Restate the order explicitly in D5 as four sub-steps to remove the ambiguity that produced
     this bug: (3a) locate companion DataType id(s) [from the create response or a pre-delete
     `findBySourceId`], (3b) delete the source (`DataSourceService.delete`), (3c) delete each
     captured companion DataType id via `DataTypeService.delete` (now `checkSourceLink` passes,
     per round 1's correct reasoning).

### Non-blocking notes

- Once Change Request 1 is fixed, re-verify `tasks.md` 4.4's DB-count assertions will actually
  pass for the `static` inline-source rollback path specifically (4.2/4.3 exercise `static` as the
  happy path, but 4.4's rollback scenario is written against `rest_api`/`sql` — the `static`
  branch's rollback path, which is the one that needs the pre-delete `findBySourceId` capture, has
  no dedicated rollback test in the current task list). Consider adding one, since it is the one
  branch where the two-argument fix (capture vs. return-value) diverges and is most likely to be
  implemented wrong again.
- `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` are still
  absent from this worktree's `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`, `README.md` present; `.concertino.env` also absent this
  round). Same as round 1: I invoked the main checkout's copies
  (`/home/matt/Development/helio/scripts/concertino/`) against this worktree's change directory to
  produce this report and its durable copy/verdict, since they are stateless filesystem utilities
  parameterized entirely by the paths passed in. Flagging again so the worktree's
  `scripts/concertino/` can be re-synced before the next round needs them.
