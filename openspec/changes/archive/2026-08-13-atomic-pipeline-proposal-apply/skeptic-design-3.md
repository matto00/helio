## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-apply/spec.md`, and both prior `skeptic-design-{1,2}.md` in full
  (the latter two as claims to re-check, not as ground truth).

**Focus 1 — is round 3's rollback-ordering fix (D5) correct and complete?**

- Re-read `design.md` D5 (lines 69-99) and `tasks.md` 2.3/2.7 in full. The fix now reads: capture
  the companion DataType's id **at create time** (task 2.3), before any rollback path can run, then
  use the captured id at rollback time (task 2.7) — never re-querying after the source is gone.
- Verified against the real implementations, not just the prose:
  - `DataSourceService.createStatic` (`DataSourceService.scala:90-135`) — confirmed it returns only
    a bare `DataSource` (`Right(ds)`), with the companion `DataType` already inserted
    (`dataTypeRepo.insert(dataType, user).map(_ => Right(ds))`, line 132) by the time it returns —
    so a `dataTypeRepo.findBySourceId` call immediately after `createStatic` succeeds is guaranteed
    to find it (no race: Future composition ordering guarantees the insert happened-before).
  - `DataTypeRepository.findBySourceId` (`DataTypeRepository.scala:65-70`) — a literal
    `WHERE source_id = ? AND owner_id = ?` filter, confirming it would return empty *only* if called
    after the FK nulls the column — which the revised plan no longer does (capture happens before
    any delete).
  - `SourceService.createSql`/`createRest` (`SourceService.scala:43-86`) +
    `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:29-64`) — confirmed
    `CreateSourceResponse.dataType` is `Some(DataTypeResponse)` if and only if the connector's
    `inferSchema` succeeded (`fetchError` is `None` in exactly that case, and vice versa) — so
    `CreateSourceResponse.dataType.map(_.id)` is available "for free" at creation time with no
    extra query, and is `None` in precisely the case (D4's fetchError branch) where there's no
    companion DataType to delete anyway.
  - `DataTypeService.delete`/`checkSourceLink` (`DataTypeService.scala:127-171`) — re-confirmed
    `checkSourceLink` no-ops (`Right(())`) when `dt.sourceId` is `None`; since the FK
    (`data_types.source_id ... ON DELETE SET NULL`, `V4__data_sources_and_types.sql:12`) has
    already nulled the companion DataType's `sourceId` by the time step 3's *delete* (not lookup)
    runs, `DataTypeService.delete` on the captured id passes cleanly — round 1's original ask
    (compose via the guarded service) and round 2's ordering fix are now both satisfied
    simultaneously, which was the tension neither round 1 nor round 2 alone resolved.
  - `DataSourceService.delete` (`DataSourceService.scala:499-516`) confirmed to end in a single
    `dataSourceRepo.delete(source.id, user)`; `DataSourceRepository.delete`
    (`DataSourceRepository.scala:188-189`) confirmed to be a real, synchronous, hard SQL `DELETE`
    (`table.filter(_.id === id.value).delete`) — not a soft-delete/background-job path — so the FK's
    `ON DELETE SET NULL` fires exactly when round 2's analysis assumed.
  - `PipelineService.delete`/`PipelineRepository` FKs (`pipeline_steps`/`pipeline_runs` both
    `REFERENCES pipelines(id) ON DELETE CASCADE`, re-confirmed directly from
    `V23__pipeline_steps.sql`/`V24__pipeline_runs.sql`) — step 1 of D5's order remains correct.
  - `data_type_rows`/`binary_refs` (`V29__data_type_rows.sql`, `V46__binary_refs.sql`) — confirmed
    **no FK** from either table to `data_types` (explicitly documented in V46's own comment as an
    existing, accepted "orphan cleanup deferred" convention, not something this ticket touches).
    Checked whether this could bite the rollback path anyway: `PipelineRunService.onRunSuccess`
    (`PipelineRunService.scala:339-394`) is the only writer to `data_type_rows`/`binary_refs`, and it
    only runs on the `Success` branch of `executeRun` — every rollback-triggering failure this
    design handles (D6's rest_api/sql Spark-submission rejection, an `addStep` failure, a run
    `Failure(ex)`) short-circuits *before* `onRunSuccess`, so no orphaned rows/binary-refs are ever
    created in any of this design's actual failure paths. Not a gap.
  - Conclusion: **round 3's D5 fix is correct and internally consistent** against the real
    `DataSourceService`/`DataTypeService`/`DataTypeRepository` implementations. The specific defect
    round 2 found (querying `findBySourceId` after the FK already nulled the column) is gone.

**Focus 2 — does the round-1 finding (compose via `DataTypeService.delete`, never a raw repository
delete) still hold?**

- Yes. `tasks.md` 2.1 ("every delete goes through `DataTypeService.delete` / `DataSourceService.delete`
  / `PipelineService.delete`, never `*Repository.delete` directly") and 2.7 are unchanged in this
  respect from round 2, and D5's text still routes every rollback delete through the guarded
  services. Matches `ticket.md`'s AC ("no direct DB writes") and the `DashboardProposalService`
  precedent (re-confirmed zero direct repository writes by reading it again).

**Focus 3 — fresh pass for any other design-soundness issue.**

- Traced `PipelineProposalSource`'s actual optionality against `design.md` D1/D2's pre-validation
  plan, using the real wire contract, not the design's paraphrase of it:
  - `schemas/pipeline-proposal.schema.json`'s `$defs.PipelineProposalSource` (lines 29-54) has
    **no `"required"` array at all** — `sourceId`, `type`, `name`, and `config` are *all* individually
    optional at the JSON-schema level.
  - `PipelineProposalProtocol.scala`'s hand-written reader (lines 67-89) matches this exactly:
    `name = obj.fields.get("name").map(_.convertTo[String])` (silently `None` if the key is absent)
    and, independently, `config = obj.fields.get("config")` — if the `"config"` key is absent, all
    four of `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig` stay `None` **regardless of what
    `type` says**, since the `kind match` only picks a slot to populate, it never requires `config`
    to be present.
  - So a legal (schema-valid) proposal can set `source.type = "sql"` with **neither `name` nor
    `config` present at all.**
  - `design.md` D2's pre-validation list never checks either of these. It says
    `pipelineName`/`outputDataTypeName` non-blank (an exact parallel check for
    `DashboardProposalService.validateStructure`'s own `dashboardName.trim.isEmpty` guard,
    re-confirmed at `DashboardProposalService.scala:69-70` — the design's own cited precedent
    *does* validate its equivalent "name" field), D1's sourceId/type mutual exclusivity, `type`'s
    enum membership, and — assuming it's present — the `sql` config's `checkQuery`. It never asks
    "is `source.name` non-blank when the inline branch is selected?" or "is the config field
    matching `type` actually populated?"
  - Traced what actually happens downstream if these are left unchecked, per source kind:
    - **`static`**: `DataSourceService.createStatic` (`DataSourceService.scala:91-92`) does
      independently guard `req.name.trim.isEmpty` → `BadRequest("name is required")`, so an absent
      `name` degrades gracefully to a clean 4xx here, *if* the implementer maps
      `Option[String] => String` via something like `.getOrElse("")` before calling it. But an
      absent `staticConfig` (no `"config"` key at all) has no such safety net — building
      `StaticDataSourceRequest(columns = ???, rows = ???)` from a `None` needs explicit handling; a
      literal, unguarded `.get` throws `NoSuchElementException` — an **unhandled 500**, exactly the
      failure mode this ticket's own D4/AC explicitly rules out for the sibling fetch-error
      guardrail ("returned as a structured error ... rather than an opaque 500").
    - **`rest_api`/`sql`**: verified `SourceService.createSql`/`createRest`
      (`SourceService.scala:43-86`) — **neither validates `request.name` for blank/empty** anywhere
      in that path (unlike `createStatic`). So an absent `source.name`, mapped to `""` (the most
      natural `Option→String` default an implementer would reach for), would **not** be rejected —
      it would silently create a real, persisted `SqlSource`/`RestSource` row (and, on successful
      schema inference, a companion DataType) with an **empty name**. This is not a rollback-safety
      bug (the created resources are still tracked and would roll back correctly on a later
      failure) — it is a *correctness* gap: a structurally incomplete proposal that D2 is supposed
      to catch "before any side effect" instead succeeds and creates a nameless resource. The same
      missing-`config` crash risk described above for `static` applies identically here
      (`sqlConfig`/`restConfig` absent → unguarded access → likely unhandled exception rather than
      a structured 4xx).
    - **`csv`**: moot in practice (D3 rejects inline csv unconditionally), but the same absent-name
      gap would apply if D3's punt were ever lifted.
  - This is not hypothetical adversarial-input paranoia disconnected from the design's own stated
    bar: the ticket's AC and D4 both explicitly commit to "a source-fetch failure is returned as a
    structured error... not an opaque 500," and design.md's own Context section opens by holding
    itself to catching bad input "before any side effect... mirroring `preValidateBindings`'s 'fail
    before any side effect' contract" (D2's own words). A `type`-set/`config`-absent or
    `type`-set/`name`-absent proposal is exactly the class of structurally-incomplete input that
    contract is supposed to catch, and as currently written it is not caught for at least the two
    most consequential branches (`sql`/`rest_api`).

### Verdict: REFUTE

### Change Requests

1. **`design.md` D2 (and `tasks.md` 2.2) must add explicit pre-validation for the inline branch's
   `name` and `config` presence — both are legally absent per the actual HEL-379 wire contract, and
   the design's current checklist doesn't cover either.**

   Required revision, to be added to D2's structural-pre-validation list, ordered *before* the
   `SqlConnector.checkQuery` step (that step cannot even be attempted without first confirming
   `sqlConfig` is `Some`):
   - When the inline branch is selected (`source.type` is set): `source.name` must be present and
     non-blank → `Left(ServiceError.BadRequest("source.name is required for an inline source"))`,
     mirroring `pipelineName`/`outputDataTypeName`'s own treatment in the same list and
     `DashboardProposalService.validateStructure`'s `dashboardName.trim.isEmpty` guard (the design's
     own cited precedent, `DashboardProposalService.scala:69-70`).
   - When the inline branch is selected: the config field matching `type`
     (`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`) must be `Some` →
     `Left(ServiceError.BadRequest("source.config is required for an inline source"))` — this check
     must precede D2's existing `SqlConnector.checkQuery(sqlConfig.query)` step, since that step is
     unreachable/unsafe to write as literally described (`sqlConfig.query`) without first
     establishing `sqlConfig` is present.
   - Update `tasks.md` 2.2 to list both checks explicitly (not just imply them via "structural
     pre-validation per design.md D1/D2"), since this is precisely the class of implicit-assumption
     gap that produced round 1 and round 2's bugs — spelling it out removes the ambiguity for the
     implementer.
   - Add a guardrail-edge-case test to `tasks.md` 4.7 (which already covers "both set"/"neither
     set"/"inline csv"/"unrecognized step type") for: inline `type` set with `name` omitted → `4xx`,
     nothing created; inline `type` set with `config` omitted → `4xx`, nothing created (at least for
     the `sql`/`rest_api` kinds, where the current design's gap would otherwise either create a
     nameless source or crash).

### Non-blocking notes

- (Carried forward from round 2, still unaddressed, still non-blocking) `tasks.md` 4.4's rollback
  test still only exercises the `rest_api`/`sql` inline branch. The `static` branch's rollback path
  is the one where the two-argument capture-at-create-time fix (return-value vs. pre-delete
  `findBySourceId`) diverges and is most likely to be implemented wrong — a dedicated
  `static`-branch rollback test (assert counts unchanged after forcing a post-creation failure, e.g.
  a step-creation failure) would catch a regression here that 4.4 as written cannot.
- The internal "companion DataType id(s) captured at creation time" state is `Option[DataTypeId]`
  for the `rest_api`/`sql` branches (single id, from `CreateSourceResponse.dataType`) but
  `Vector[DataType]`/`Vector[DataTypeId]` for the `static` branch (from `findBySourceId`, which
  returns a `Vector`). `design.md` uses "id(s)" throughout, suggesting awareness of this, but never
  states the unification (e.g. always carry a `Vector[DataTypeId]`, singleton for the
  rest_api/sql case). Minor — a competent implementer will reach for this naturally — but worth
  making explicit given how much plumbing precision this rollback path has already needed across
  three rounds.
- `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` are still
  absent from this worktree's `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`, `README.md` present; `.concertino.env` also absent). Same
  as rounds 1/2: I invoked the main checkout's copies
  (`/home/matt/Development/helio/scripts/concertino/`) against this worktree's change directory to
  produce this report and its durable copy/verdict, since they are stateless filesystem utilities
  parameterized entirely by the paths passed in. Flagging a third time so the worktree's
  `scripts/concertino/` can be re-synced.
