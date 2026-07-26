## Context

`helio-news` scans resource *names* by prefix to find and delete a run's resources
(`HelioClient.cleanup_news_resources()`). We're adding a real grouping primitive
(`tag`) and a bulk-teardown endpoint. **This is a bulk-delete feature against
production data with real dashboards** — a scoping miss destroys user data, not a
pixel. Existing single-resource deletes already have DB-level FK cascade behavior
(confirmed in migrations):

- `pipelines.source_data_source_id → data_sources(id) ON DELETE CASCADE` — deleting a
  DataSource cascades to **any** dependent Pipeline, tagged or not.
- `pipelines.output_data_type_id → data_types(id) ON DELETE CASCADE` — deleting a
  pipeline's output DataType cascades to delete **that Pipeline**, tagged or not.
- `data_types.source_id → data_sources(id) ON DELETE SET NULL` — deleting a
  DataSource orphans (does not delete) its auto-inferred companion DataType.
- `pipeline_steps`/`pipeline_runs`/`pipeline_schedules` cascade from `pipelines` —
  intrinsic children, not independently taggable, no extra handling needed.
- `DataTypeService.delete` already refuses (app-level, pre-existing) when the
  DataType is panel-bound (`existsBoundToAnyOwnedPanel`) or is a still-linked
  source companion (`checkSourceLink`) — reused as-is, not re-implemented.

RLS (V35, `rls-owner-tables`) already FORCE-enforces owner isolation on all three
tables via `withUserContext` + `current_setting('app.current_user_id')`; the app
pool errors if the session var is unset. Owner scoping for tag teardown rides on
this existing DB-layer guarantee rather than reimplementing it in the service.

## Goals / Non-Goals

**Goals:**
- A tagged resource is discoverable and deletable purely by tag, never by name.
- **A bulk teardown never deletes a resource that does not carry the tag** — this is
  the hard constraint the acceptance criteria and the human review gate require.
- Deterministic, previewable, all-or-nothing bulk delete.

**Non-Goals:**
- Multi-tag / namespaced-tag model (see Decision 1).
- Tagging or deleting dashboards/panels (ticket marks dashboards optional, panels
  explicitly out of scope — HEL-363 territory).
- Retro-tagging existing resources via update endpoints.
- Changing existing single-resource delete cascade behavior for untagged callers.

## Decisions

**1. Single free-form `tag: Option[String]` column, not a multi-tag array/join table.**
The concrete driving use case (helio-news) needs one grouping key per workflow run.
A single scalar avoids ANY/ALL matching ambiguity on a *delete* path — for a bulk
delete, "does this resource carry the tag" must have one unambiguous answer. Stored
the same way `config` is (`jsonbStringType`-style `TEXT` column is unnecessary here
since it's a scalar, not JSON — plain `TEXT`, nullable, no default, `CHECK (length(tag) <= 200)`).
Partial index `(owner_id, tag) WHERE tag IS NOT NULL` on each of the three tables for
the list-filter and teardown-plan queries. Multi-tag is a natural additive follow-on
if a real use case appears.

**2. Cascade decision: refuse-on-dependent-not-in-this-batch, not silent cascade,
not orphan.** Reusing the *existing* single-delete cascade unconditionally (as the
ticket's scope text initially suggests) would violate the acceptance criterion
"resources without the tag are untouched": deleting a tagged DataSource with a
dependent Pipeline outside this teardown's tag would cascade-delete that Pipeline
today. Orphaning (nulling the FK) isn't viable — `pipelines.source_data_source_id`
and `output_data_type_id` are `NOT NULL`; changing that is a much bigger, unrelated
schema change. So: **the teardown plan computes, inside one transaction, whether
any tagged DataSource has a dependent Pipeline whose `tag` is not the same tag
being torn down (`pipeline.tag IS DISTINCT FROM :tag` — covers both an untagged
dependent, `tag IS NULL`, and one tagged into a different, live batch, e.g.
`tag = 'U'`), or any tagged output DataType has a producing Pipeline whose `tag`
is likewise `IS DISTINCT FROM :tag`. If so, the whole call is blocked — nothing is
deleted** — and the response lists exactly which resource is blocked and by what.
**This is deliberately the same predicate shape as Decision 6's source-link guard
below — both guards must reject on "not in this batch," never narrow to "has no
tag at all," or a DataSource tagged `T` with a Pipeline tagged `U` (a different,
live batch) would silently cascade-delete `U`'s pipeline the moment `T`'s teardown
runs `DELETE FROM data_sources WHERE tag = 'T'`, since Postgres's `ON DELETE
CASCADE` does not consult the dependent row's own tag.** The caller's remedy is
explicit: tag the dependent into this same batch too, or delete it individually
first. This keeps the *existing* per-resource delete/cascade behavior completely
unchanged for everyone else, and makes tag-teardown strictly safer than a manual
delete loop, matching the "cannot silently reach untagged — or differently
tagged — data" requirement.

**3. All-or-nothing, computed and executed inside one DB transaction, app-pool only.**
One `WorkspaceTeardownRepository` method: a single Slick DBIO composed of the
tagged-set + untagged-dependent-check SELECTs, then (only if clean and not
`dryRun`) the DELETE actions for Pipelines → DataTypes → DataSources, all wrapped in
`.transactionally` under `withUserContext(user.id.value)` (mirrors
`DashboardContentsOps.replaceContents`, HEL-363's real-transaction precedent).
**Hard constraint: every read and write inside this composed DBIO runs on the
app pool via `withUserContext` — never `withSystemContext` (the privileged,
RLS-bypassing pool).** RLS is the owner-scoping backbone this whole design leans
on (Context section); a sub-check that silently used the privileged pool would
defeat that guarantee for exactly the sub-check protecting the most dangerous
part of the operation. This rules out calling `DataSourceRepository.findByIdInternal`
(privileged pool) from inside the transaction — see Decision 6 for the concrete
fix. `DataTypeRepository.existsBoundToAnyOwnedPanel` already runs via
`withUserContext`, so its underlying query composes cleanly once exposed as a
bare `DBIO` (see Decision 6).
Order matters for the *reported* counts to be precise (deleting Pipelines first
means the later DataType/DataSource cascades are no-ops, not double-counted) even
though Postgres would enforce correctness regardless of order.
Residual TOCTOU: a concurrent create landing between the plan SELECT and the DELETE
within the same transaction is a narrow, same-transaction window; mitigate by doing
the untagged-dependent re-check as the *last* read immediately before issuing the
DELETEs (not a separate earlier call) — flagged as an implementation note, not
deferred to the executor's judgment on ordering.
**On-disk file cleanup is explicitly outside the transaction.** For file-backed
DataSources (CSV/Text/PDF/Image), `DataSourceService.delete` deletes the blob via
`fileSystem.delete(...)` — an async, non-`DBIO` side effect — *before* the DB
delete, with a `.recover { case _ => () }` best-effort posture (a failed file
delete never blocks the DB delete). The teardown transaction cannot include this
step (it isn't a `DBIO` action). Decision: after the DB transaction **commits**,
run the same best-effort `fileSystem.delete` for every torn-down file-backed
DataSource's stored path, matching the existing single-delete posture exactly —
a file-delete failure here does not roll back or fail the already-committed DB
teardown (files are not authoritative state; an orphaned blob is a leak, not a
correctness bug, and matches today's behavior for a single manual delete that
races a filesystem error).

**4. `dryRun` is a request flag, not a separate endpoint, and always returns the
computed plan.** `POST /api/workspace/teardown {tag, dryRun}` runs the identical
plan computation for both modes; `dryRun: true` (or the blocked case) never issues
the DELETE actions. Response always reports `{ tag, dryRun, committed, blocked,
conflicts, sourcesDeleted, pipelinesDeleted, typesDeleted }` — counts mean "would be
/ were affected" either way, so a dry run is a true preview of magnitude, not just
a conflict check. HTTP 200 in both the clean and blocked cases (a block is an
expected, informative outcome for an agent, not a client error); only malformed
input or auth failure returns 4xx.

**5. List/filter reuses existing endpoints.** `GET /api/data-sources|pipelines|types
?tag=` (owner-scoped exact match) — no new read endpoint; this doubles as the
"preview what's tagged" surface independent of the teardown dry-run.

**6. Existing per-DataType guards: one exposed as a shared DBIO, one reimplemented
app-pool-scoped — not called as-is (they can't be; see Decision 3).**
`DataTypeService.delete` today runs two guards that must also block teardown for a
tagged DataType, but neither can be spliced into the new app-pool transaction
unmodified:
  - `existsBoundToAnyOwnedPanel` (`DataTypeRepository`): its query already runs on
    the app pool, just wrapped in its own `withUserContext` call site. **Fix:**
    extract the underlying query into a `DBIO[Boolean]`-returning method on
    `DataTypeRepository` (e.g. `existsBoundToAnyOwnedPanelAction`); the existing
    call site wraps it in `withUserContext` exactly as today (zero behavior
    change), and the new teardown transaction composes the same `DBIO` directly.
    One query, two callers — no logic duplicated.
  - `checkSourceLink` (`DataTypeService`): today calls
    `DataSourceRepository.findByIdInternal` on the **privileged pool**, because its
    job there is user-facing error-message rendering (looking up the source's
    *name*) for a caller who already owns the DataType — not an ownership check.
    Teardown doesn't need the name, only the existence fact — but **not a bare
    existence check**: every `DataSourceService`/`SourceService` create path builds
    a DataSource and its auto-inferred companion DataType together in the same
    call (`sourceId = Some(ds.id)`), so a DataSource tagged `T` and its companion
    DataType tagged `T` are the *default* shape of a tagged resource graph — the
    exact pattern the ticket's own helio-news example uses. At the moment this
    guard runs (plan-computation happens before any deletes in the same
    transaction — Decision 3), the tagged source row is still physically present.
    A bare "does it exist" check would therefore block on the single most common
    case and defeat the ticket's core acceptance criterion. **Fix (mirrors
    Decision 2's own "untagged dependent" scoping, applied consistently here):**
    the check blocks only when a DataSource with `id = dt.sourceId` exists **and
    is not itself tagged with the same tag being torn down** — i.e.
    `WHERE data_sources.id = dt.sourceId AND data_sources.tag IS DISTINCT FROM :tag`
    (`IS DISTINCT FROM` handles a `NULL` source tag correctly: an untagged source
    always blocks). `WorkspaceTeardownRepository` runs this as its own narrow,
    app-pool, `withUserContext`-scoped query — it does not call `checkSourceLink`.
    This is a deliberate, small duplication of *existence-and-tag* logic (not the
    full guard), justified because it's the only way to keep this check inside
    the RLS-scoped transaction (Decision 3's hard constraint) — accepted drift
    risk, mitigated by a code comment in both places cross-referencing the other
    (`DataTypeService.checkSourceLink` / `WorkspaceTeardownRepository`'s
    companion-link check) so a future schema change to one is a prompt to check
    the other. Extracting a single shared app-pool helper is a reasonable
    follow-on if a third caller ever needs the same check.
  A hit on either guard is a blocking conflict (whole call refused), matching
  Decision 2/3's all-or-nothing shape rather than silently skipping that one
  DataType.

**7. Migration V73** (`add_resource_tag.sql`) — confirmed free at proposal time
(latest is V72); executor re-confirms immediately before `git push` per branch
V-number contention risk.

**8. Wire-format Option handling for `tag`/`dryRun`.** This codebase has repeatedly
hit spray-json omitting `Option = None` fields from the wire rather than emitting
`null` (HEL-340/417 series). The `tag: Option[String]` field on create/response
protocols and `dryRun: Option[Boolean]` on the teardown request must be normalized
at the service/route boundary (treat "field absent" and "field null" identically —
both mean "no tag" / "dryRun defaults to false"), and tested with the field
literally absent from the JSON payload, not just set to `null`.

## Risks / Trade-offs

- [Single-tag limits multi-group use cases] → Out of scope; additive multi-tag is a
  clean follow-on, not blocked by this design.
- [Refuse-on-block means an agent must resolve conflicts before any deletion happens,
  even for the 99% of the tagged set that's clean] → Deliberate: partial-delete on a
  bulk-teardown-by-tag is a worse failure mode (silent partial state) than a clear
  all-or-nothing refusal with a conflict list.
- [New `/api/workspace` route prefix has no existing backend precedent — MCP's
  `get_workspace_context` is a pure client-side fan-out] → Namespacing is still
  correct (matches the ticket's suggested endpoint shape); no existing route
  collides.
- [Decision 6's existence-only reimplementation of the source-link check duplicates
  a slice of `checkSourceLink`'s logic] → Bounded and explicit (see Decision 6);
  cross-referenced in code comments; not the full guard, just the existence
  predicate that must run app-pool-scoped to satisfy Decision 3's hard constraint.
- [Post-commit file cleanup (Decision 3) means a crash between DB commit and file
  delete leaves an orphaned blob] → Matches today's exact single-delete posture
  (`.recover { case _ => () }`, best-effort); not a new risk introduced by teardown.

## Planner Notes

- Self-approved: single-tag (not multi-tag/array) model — ticket explicitly offered
  "tags (or a single namespace)" as alternatives.
- Self-approved: dashboards excluded entirely (ticket says "optional"; no acceptance
  criterion requires it; keeps blast radius and test surface smaller).
- Self-approved: refuse-on-untagged-dependent as the cascade semantics, since it's
  the only option that satisfies the literal acceptance criterion given existing FK
  cascade behavior — not escalated, since the ticket itself asked for this decision
  to be made deliberately, not asked for human sign-off on which option.
