## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **FK cascade claims (design.md Context section)** — read `backend/src/main/resources/db/migration/V22__pipelines.sql` and `V4__data_sources_and_types.sql` directly.
  - `pipelines.source_data_source_id REFERENCES data_sources(id) ON DELETE CASCADE` — confirmed (V22:4).
  - `pipelines.output_data_type_id REFERENCES data_types(id) ON DELETE CASCADE` — confirmed (V22:5).
  - `data_types.source_id REFERENCES data_sources(id) ON DELETE SET NULL` — confirmed (V4:12).
  - All three claims are accurate; the "refuse-on-untagged-dependent" cascade decision (Decision 2) is correctly derived from real DB behavior, not an assumed one.

- **RLS backbone claim** — read `V35__rls_owner_only_tables.sql` in full. Confirmed `FORCE ROW LEVEL SECURITY` + owner-equality `USING` policies on `pipelines`, `data_sources`, `data_types`, with the documented nullable-owner_id-evaluates-to-false behavior. The design's claim that owner scoping "rides on this existing DB-layer guarantee" is accurate for any DBIO executed via `ctx.withUserContext` — **conditionally** (see Change Request 1).

- **Migration version** — `ls backend/src/main/resources/db/migration` confirms latest is `V72__add_lookup_op.sql`; `V73` is genuinely free at review time, matching design.md/tasks.md's claim.

- **Route collision check** — `grep -rn workspace backend/src/main/scala/com/helio/api/routes/` returns nothing; no existing `/api/workspace` prefix, confirming the Risks section's claim.

- **Transaction precedent (`DashboardContentsOps.replaceContents`)** — read in full. It composes raw `DBIO` fragments (delete/insert/update) with `.transactionally`, but note it runs under `ctx.withSystemContext` (privileged pool, ACL pre-checked by the caller), not `ctx.withUserContext` as design.md Decision 3 proposes for the new teardown transaction — a deliberate (and arguably safer) divergence from the cited precedent, not itself a problem.

- **`DbContext.withUserContext`/`withSystemContext`** — read in full (`backend/src/main/scala/com/helio/infrastructure/DbContext.scala`). Confirmed: `withUserContext` runs on the **app pool** (RLS-enforced), `withSystemContext` runs on the **privileged pool** (RLS-bypassed, `BYPASSRLS` role) — these are two distinct `JdbcBackend.Database` instances. A single `DBIO` composition can only be `.run()` against one of them; you cannot atomically compose actions that must run against both pools into "one DB transaction."

- **Traced the actual guard implementations the design proposes to reuse**, since design.md Decision 2/6 and tasks.md 3.1 both claim the teardown transaction will "reuse" `DataTypeService.delete`'s existing guards:
  - `DataTypeRepository.existsBoundToAnyOwnedPanel` (line 186-192): its raw SQL is embedded **inside** its own `ctx.withUserContext(...)` call — not exposed as a standalone `DBIO` fragment that another transaction can splice in.
  - `DataTypeService.checkSourceLink` (line 140-152, `DataTypeService.scala`) — **this check lives in the service layer, not `DataTypeRepository`** (tasks.md 3.1 misattributes it to the repository, evidence it wasn't checked against the actual code). It calls `dataSourceRepo.findByIdInternal(srcId)`, which runs via `ctx.withSystemContext` — the **privileged, RLS-bypassing pool**.
  - `DataSourceService.delete` (line 460-477) sequences `fileSystem.delete(...)` (an async, non-transactional filesystem side effect for CSV/Text/PDF/Image sources) **before** `dataSourceRepo.delete`. This is not a `DBIO` action at all — it cannot appear inside a Slick transaction.

### Verdict: REFUTE

The safety-critical decisions the human's pre-brief demanded (owner scoping, cascade semantics, all-or-nothing) are the right *shape* of decision — Decision 2 (refuse-on-untagged-dependent) is well-reasoned and correctly derived from the real FK cascade behavior, and RLS is a genuine backbone for owner scoping. But the concrete mechanism the design commits to for making all of this atomic and safe — "a single Slick DBIO ... wrapped in `.transactionally` under `withUserContext`, reusing each resource's existing service-layer delete, including its existing guards" (Decision 2/3/6, and echoed as a binding spec requirement in `workspace-tag-teardown/spec.md`'s "Teardown is all-or-nothing") — is not actually achievable as literally described, and the design doesn't acknowledge or resolve the gap. That gap sits directly on top of the ticket's two non-negotiable requirements (owner scoping, all-or-nothing/no-silent-cascade), so it needs to be resolved at the design gate, not discovered mid-implementation.

### Change Requests

1. **Reconcile "single transaction" with "reuse existing guards," and fix the tasks.md misattribution.** `checkSourceLink`'s existence check (`DataTypeService.scala:140-152`) runs on the privileged pool (`ctx.withSystemContext` via `DataSourceRepository.findByIdInternal`) — a different `Database`/connection pool than the app-pool `withUserContext` transaction the teardown design commits to. It cannot be spliced into the new single-transaction `DBIO` as-is, and `existsBoundToAnyOwnedPanel`'s raw SQL is likewise not exposed outside its own `withUserContext` wrapper. Design.md and tasks.md 3.1 need to explicitly decide and state one of:
   - (a) refactor `DataTypeRepository`/the source-link check into raw-`DBIO`-returning helpers (owned by the app pool, owner-scoped) that both the existing `DataTypeService.delete` path and the new teardown transaction call — the architecturally correct fix, but currently absent from tasks.md as its own task; or
   - (b) explicitly reimplement equivalent owner-scoped, app-pool checks inside `WorkspaceTeardownRepository` and say so plainly (accepting the drift risk of two copies of the same guard logic).
   Either is acceptable, but the design must pick one and tasks.md must carry the concrete step — "reuse the existing... queries" is not implementable as written, and per Decision 3's own TOCTOU discussion, the check must genuinely execute inside the same owner-scoped transaction as the delete, not via a privileged/RLS-bypassing call that happens to be safe today only because the caller already pre-validated ownership elsewhere.

2. **State whether guard-check reimplementations inside the teardown transaction are required to run app-pool/owner-scoped only.** Because RLS owner-scoping is the backbone the whole design leans on (per the Context section's own framing), any part of the new transaction that ends up using the privileged pool (as `checkSourceLink`'s current implementation does) bypasses RLS entirely for that sub-check. Add an explicit constraint to design.md Decision 3/6 (and a corresponding acceptance scenario or test in tasks.md 6.x) that every read/write inside `WorkspaceTeardownRepository`'s transaction runs under `withUserContext`, never `withSystemContext` — this is currently assumed, not stated, and the one cited precedent for reuse (`checkSourceLink`) violates it.

3. **Decide what happens to on-disk files for torn-down file-backed DataSources.** `DataSourceService.delete` deletes the underlying CSV/Text/PDF/Image blob (`fileSystem.delete(source.config.path)`) before deleting the DB row (`DataSourceService.scala:460-477`) — this is a real, non-DB side effect that cannot live inside "the DELETE actions ... wrapped in `.transactionally`" as Decision 3 describes. Neither design.md nor tasks.md addresses what happens to these files when a tagged DataSource is torn down via the new endpoint. Silently skipping file cleanup is an orphaned-storage leak inconsistent with the existing single-delete behavior the design claims to mirror. Decide explicitly (e.g., post-commit best-effort file cleanup after the DB transaction commits, matching the existing `.recover { case _ => () }` best-effort posture) and state it in design.md; add a corresponding task/test if file cleanup is in scope, or an explicit non-goal note if it's deliberately deferred.

### Non-blocking notes

- Tasks.md 2.3's uncertainty about where the pipeline output `DataType` row is actually inserted (flagging both `PipelineService`/`PipelineRunService`) is well-founded — I traced it and the insertion is in `PipelineRunService`, not `PipelineService`. This is a reasonable open item for the executor to confirm, not a design flaw.
- Consider calling out the team's known spray-json gotcha (Option fields omitted rather than nulled on the wire) for the new `tag`/`dryRun` optional fields, since normalize-at-boundary has bitten this codebase before (HEL-340/417 series).
- Decision 4's "HTTP 200 for both clean and blocked outcomes" is a reasonable, clearly-stated API choice — no objection.
