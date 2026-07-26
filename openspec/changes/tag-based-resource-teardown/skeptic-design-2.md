## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round-1 CR1 (pool composability) — now resolved for the two guards it named.**
  Read `DataTypeRepository.scala` and `DataTypeService.scala` fresh.
  - `existsBoundToAnyOwnedPanel` (`DataTypeRepository.scala:186-192`): its raw SQL
    (`sql"SELECT COUNT(*) FROM panels WHERE type_id = ... AND owner_id = ..."`) is
    already app-pool logic, wrapped only in its own `ctx.withUserContext(...)` call.
    Extracting the inner fragment into a bare `DBIO[Boolean]`-returning method (design.md
    Decision 6 / tasks.md 3.1) is a trivial, zero-behavior-change refactor — confirmed
    composable into a larger app-pool DBIO chain.
  - `checkSourceLink` (`DataTypeService.scala:140-152`) still calls
    `dataSourceRepo.findByIdInternal(srcId)`, confirmed still `ctx.withSystemContext`
    (privileged pool) in `DataTypeRepository.scala:70-72`. The revised design correctly
    does **not** try to call it from the transaction; Decision 6 instead has
    `WorkspaceTeardownRepository` run its own app-pool EXISTS query. Composability
    problem from round 1 is resolved as far as pool selection goes — see below for a
    new problem in *what* that query checks.
- **Round-1 CR2 (hard `withUserContext`-only constraint) — realistic.** Read
  `DbContext.scala` in full again. `withUserContext`/`withSystemContext` are two
  distinct `Database` handles; a single composed `DBIO` can only run against one.
  Traced every dependency the teardown transaction needs (`existsBoundToAnyOwnedPanel`,
  the new source-link EXISTS check, `DataSourceRepository`/`PipelineRepository`/
  `DataTypeRepository`'s own tables for the tagged-set SELECTs and DELETEs) — none of
  them require the privileged pool once Decision 6's two fixes are applied. Also
  confirmed via `PipelineSchedulerService.scala` that pipeline deletion has no
  in-memory/non-DBIO side effect to clean up (scheduler is tick/poll-driven off
  `pipeline_schedules`, which cascades from `pipelines` per
  `V62__pipeline_schedules.sql:25`) — no additional privileged-pool need lurking there.
  The hard constraint is achievable as stated.
- **Round-1 CR3 (file cleanup) — accurately matches real code.** Read
  `DataSourceService.scala:460-477`: `fileSystem.delete(...).recover { case _ => () }`
  runs *before* the DB delete, non-`DBIO`, best-effort. Design's post-commit
  best-effort file cleanup (Decision 3 addendum, task 3.4) matches this exactly.
- **DBIO composition precedent still holds.** Re-read `DashboardContentsOps.replaceContents`
  in full — it composes `SELECT.flatMap { ... deleteAction andThen insertAction andThen
  updateAction ... }.transactionally`, then `ctx.withSystemContext(action)`. Structurally
  identical to what the revised design proposes for `WorkspaceTeardownRepository`, just
  against `withUserContext`. `DbContext.withUserContext[R](userId)(action: DBIO[R])` takes
  exactly one composed `DBIO[R]`, so this pattern transfers cleanly.
- **Migration V-number.** `ls backend/src/main/resources/db/migration | sort -V | tail -5`
  → latest is `V72__add_lookup_op.sql`; V73 is still free.
- **Cascade claims (Context section) re-checked**, unchanged from round 1 and still
  accurate: DataSource→Pipeline `ON DELETE CASCADE`, DataType(output)→Pipeline
  `ON DELETE CASCADE`, DataSource→DataType(companion) `ON DELETE SET NULL`
  (`V22__pipelines.sql`, `V4__data_sources_and_types.sql`).

### New finding — Decision 6's source-link EXISTS check blocks the ticket's own primary use case

This was not raised in round 1 and is a genuinely new, code-traced problem in the
*replacement logic itself*, not an incomplete application of the prior fix.

Every `DataSourceService`/`SourceService` create path builds the DataSource **and**
its auto-inferred companion `DataType` together in the same call, always setting
`sourceId = Some(ds.id)` on the companion type (confirmed by grep across
`DataSourceService.scala` — 5 call sites — and `SourceService.scala:236`,
`CreateSourceEnvelope.scala:49`). This is not an edge case; it is how every
file/SQL/REST-backed DataSource acquires its schema DataType. Tasks.md 2.1/2.3
implies the same `tag` supplied at DataSource-create time is what threads through to
this create call, so a tagged DataSource's companion DataType is tagged too — exactly
the pattern helio-news itself uses (`-src-` companion types alongside `news-` sources,
per the ticket's own Context section).

Decision 6's replacement for `checkSourceLink` is: *"does a DataSource with `id =
dt.sourceId` still exist"* — a bare existence check, not scoped by tag. Design.md
Decision 3 / tasks.md 3.3 both establish that the **entire plan (all guard checks) is
computed first, and the DELETE actions issue only after the plan is confirmed clean**
— i.e., at the moment this EXISTS check runs, the tagged DataSource row is still
physically present (its own DELETE hasn't executed yet in this same transaction).

Consequence: for the standard case — a DataSource tagged `T` and its companion
DataType also tagged `T`, both intended to be torn down together in the same call —
the EXISTS check finds the source "still exists" (true, at check time) and reports it
as a blocking conflict, refusing the *entire* teardown. This isn't a rare corner case;
it's the default shape of a file/SQL/REST source's resource graph, and it directly
matches the ticket's own worked example (helio-news `-src-` companion types). As
written, tag-based teardown would be blocked for essentially every DataSource +
companion-DataType pair sharing a tag — the feature would not deliver on its own
motivating use case.

Compare this to Decision 2's treatment of the symmetric case (tagged DataSource →
dependent Pipeline; tagged output DataType → producing Pipeline): both of those are
correctly scoped to trigger **only when the dependent is *not* tagged** (i.e., not
part of the same delete batch). Decision 6's source-link check uses a different,
un-scoped rule ("exists at all") instead of the same "exists and is *not* part of
this tagged teardown set" rule Decision 2 already establishes elsewhere in the same
document. The fix is to make Decision 6 consistent with Decision 2's own pattern:
the source-link guard should trigger only when a DataSource with `id = dt.sourceId`
exists **and is not tagged with the same tag being torn down** (e.g. `WHERE
data_sources.id = dt.sourceId AND (data_sources.tag IS DISTINCT FROM :tag)`).

Tasks.md 3.2 and 6.6 currently encode the *unscoped* version as intended behavior
("still-linked source-companion tagged DataType blocks — same conflict reasons as
`DELETE /api/types/:id`" — with no exception for a same-tag source that's also being
torn down), so this isn't just an implementation slip to fix during coding; it's
baked into the design and the test plan as currently written.

### Verdict: REFUTE

The round-1 fixes hold up under fresh, independent verification — pool composability,
the `withUserContext`-only constraint, and file cleanup are all real, accurate, and
implementable as described. But re-reviewing the whole design fresh (as instructed)
surfaced a new, concrete, code-traced flaw in Decision 6's reimplementation: as
written, it would make tag-based teardown refuse to run for the default DataSource +
auto-inferred-companion-DataType shape, defeating the ticket's core acceptance
criterion for the common case. This is a genuinely new substantive design flaw, not a
consistency nit or an incomplete application of a round-1 fix, so it is in scope for
this round per the escalation policy.

### Change Requests

1. **Scope Decision 6's source-link existence check to exclude sources in the same
   tagged teardown batch.** In `design.md` Decision 6 and `tasks.md` 3.2, change the
   check from "does a DataSource with `id = dt.sourceId` exist" to "does a DataSource
   with `id = dt.sourceId` exist **that is not itself tagged with the tag being torn
   down**" (i.e. `WHERE id = dt.sourceId AND tag IS DISTINCT FROM :tag`), mirroring
   the already-correct "untagged dependent" scoping Decision 2 uses for the
   DataSource→Pipeline and DataType→Pipeline cases. Update `tasks.md` 3.2's wording
   and `tasks.md` 6.6 / the `workspace-tag-teardown/spec.md` "Existing per-DataType
   delete guards still apply" scenario to state the guard blocks only when the linked
   source is **not** also tagged for this same teardown; add a companion positive-path
   scenario/test proving a DataSource tagged `T` and its companion DataType tagged `T`
   *are* both deleted together by `teardown {tag: "T"}` (this is currently untested —
   6.6 only tests the blocking direction).

### Non-blocking notes

- `proposal.md`'s "What Changes" section still says teardown deletes resources "reusing
  each resource's existing service-layer delete, including its existing guards" — this
  is stale relative to design.md Decision 6's revised mechanism (raw DBIO deletes
  composed directly in `WorkspaceTeardownRepository`, plus a reimplemented existence-only
  guard, not a call into `DataTypeService.delete`/`DataSourceService.delete`). `design.md`
  and `tasks.md` (the operative artifacts) are internally consistent and correct; only
  `proposal.md`'s prose lags. Worth a cleanup pass but not blocking — the executor would
  follow tasks.md, not proposal.md's summary.
- The Decision 6 reimplementation was independently verified as a *safe* replacement
  from an ownership/RLS standpoint (the question the orchestrator specifically asked):
  since every companion DataType's `sourceId` is set to a DataSource created by the
  same owner in the same call, and the check runs under `withUserContext` (RLS-scoped),
  the app-pool existence check is equivalent to the original privileged-pool check for
  all legitimate data shapes, and task 6.12 correctly tests the defensive corruption
  case (cross-owner `sourceId`) without leaking existence info. The problem isolated in
  this report is orthogonal — not an ownership/RLS gap, but a same-tag-exclusion gap.
