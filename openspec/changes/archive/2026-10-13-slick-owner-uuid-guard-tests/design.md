## Context

See proposal.md (Why). Ground truth on base `f63ab8365`:

- `DataSourceRepository.scala:1159` `def ownerId = column[Option[UUID]]("owner_id")`; `rowToDomain` (line 50) maps
  `None` to `UserId("")`; the row builder (line 114) maps `""` to `None`. V119 made the column NOT NULL; no later
  migration (V120..V130) relaxes it.
- `findAllRestApiRawInternal` (line 313) returns `(String, Option[UUID], String, String)`; its only caller is
  `RestSourceConnectorMigration.run`, whose `migrateOne` has a `case None` ownerless skip (lines 114-118) plus header
  doc lines 32-33 describing it. `RestSourceConnectorMigrationSpec` line 221-223 comment says "The defensive branch in
  the migration is unchanged" — false after this change.
- Other `DataSourceTable` users: `WorkspaceTeardownRepository` (filters `r.ownerId === ownerUuid`), `PipelineRepository`
  (joins on `id`), `PipelineCycleGuard`. All compile-checked.
- `V119OwnerFkMigrationSpec.scala` (414 lines): harness (plumbing + seeding, ~155 lines) and four groups: cleanup (2
  tests), guard abort (4 abort + 1 live-mention), "After V119, inserts and user deletes" (7), inventory doc (1).
- `docs/user-reference-inventory.md` lines 10 and 68 name `V119OwnerFkMigrationSpec` as the parser of the inventory
  table and the pinner of user-delete outcomes. That doc is modified by parked PR #994, so we must not edit it.
- Guard SQL: `s.op IN ('join','lookup','union','upsertsource') AND strpos(s.config, t) > 0`; roots and form panels are
  separate counts. Step config shapes: `LookupConfig`/`UnionConfig` carry `secondaryInput` encoded by
  `SecondaryInput` as `{"kind":"source","dataSourceId":...}` (`domain/steps/SecondaryInput.scala`).

## Goals / Non-Goals

**Goals:** non-optional owner type end to end in the repository; dead branch gone; six guard clauses each pinned by a
mutation-proven test; spec file split with no lost test. **Non-Goals:** editing V119, any migration, the inventory doc,
the domain ADT, or any file in parked PRs #994/#996/#998/#986/#999.

## Decisions

**D1. `column[UUID]` and `DataSourceRow.ownerId: UUID`; conversion stays inside the DBIO.** `rowToDomain` becomes
`UserId(row.ownerId.toString)`; `domainToRow` becomes `UUID.fromString(ds.ownerId.value)`. Alternative (keep Option,
just drop the fallback) rejected: the ticket asks for the type to match the schema. Behaviour preservation of the
insert path: `DbContext.withUserContext` (`DbContext.scala:50`) takes its action by value, so `table += domainToRow(..)`
is evaluated before any Future exists. Today an empty owner becomes a NULL insert rejected by the DB (23502) as a
FAILED FUTURE; a bare `UUID.fromString("")` would instead throw synchronously out of `create` (`:222`) and
`insertDatasetSourceAction` (`:349`/`:370`). Decision (self-approved, option b of skeptic-design-1): defer the
conversion into the DBIO chain (e.g. `DBIO.successful(()).flatMap(_ => table += domainToRow(source))` or an equivalent
`DBIO.from(Future.fromTry(Try(...)))`), so a malformed/empty owner is still a failed Future and never a synchronous
throw. Pinned by a committed test: `create` with `UserId("")` returns a failed Future (no synchronous exception), and
no row is written. Rejected alternative (a), keeping the eager call and arguing unreachability by grep: it changes the
failure mode on an argument rather than an observation. The executor still greps for production paths that can build
a `DataSource` with an empty owner and records the result in `sql-parity.md`.

**D2. Behaviour preservation by SQL parity, over a grep-driven site list.** The executor SHALL enumerate EVERY
reference to `DataSourceTable`'s `ownerId` / `DataSourceRow.ownerId` in `backend/src/main` by grep (record the grep
command and its full hit list in `sql-parity.md`). Known sites at base, which the list must at least contain:
`DataSourceRepository.scala` `:50`, `:114`, `:125`, `:126`, `:145`, `:182`, `:193`, `:265`, `:315`, `:411`, `:529`,
`:1159` (named by enclosing method in the record, not line number alone); `WorkspaceTeardownRepository.scala:107`,
`:135`; `PipelineCycleGuard.scala:45-47` (`resolveDisplayNamesAction` — a REAL caller edit: `ownerId.exists(_.toString ==
actingUserId)` becomes `ownerId.toString == actingUserId`, same semantics since the column cannot be NULL). For every
site that builds a Slick query, capture the generated SQL (`.result.statements` / `.insertStatement` /
`.updateStatement`) on base and on head with a throwaway, uncommitted probe, and diff. Expected byte-identical. Any
non-identical statement SHALL get a committed NOBYPASSRLS `VerifiedEmbeddedPostgres` test. Regardless, re-run the
existing NOBYPASSRLS repository specs (`DataSourceRepositoryApplyWriteBacksRlsSpec`,
`DataSourceReferenceGuardNonSuperuserSpec`, `UpsertTargetWritableRlsSpec`) plus `DataSourceRepository*Spec`,
`RestSourceConnectorMigrationSpec`, `WorkspaceTeardown*Spec` and the `PipelineCycleGuard` specs. Read path: a NOT NULL
column can never yield the old `None`, so `UserId("")` was unreachable.

**D3. Drop the ownerless branch.** `migrateOne` takes `ownerUuid: UUID`; remove `case None` and header lines 32-33
(renumber the remaining cases, and fix the header's "four outcomes" at line 29 to the new count); update `findAllRestApiRawInternal`'s doc ("owned, ownerless, ...") and
`RestSourceConnectorMigrationSpec`'s comment at 221-223 (the branch is now removed, not "unchanged"). Collapse
`seedLegacyRestSource(ownerIdOpt: Option[UserId], ...)` to a non-optional owner if every caller passes `Some`.

**D4. One guard test per reference kind.** Keep the existing root (two-root), join, upsertsource and form-panel tests;
add `lookup` and `union` abort tests mirroring the join test (orphan referenced only via that step's
`secondaryInput` source; config shape taken from `LookupConfig`/`UnionConfig` + `SecondaryInput`, cited in the test).
Extend the live-mention negative test with lookup and union steps on a live source. Mutation matrix (six mutations,
each applied to the V119 SQL in the worktree, never committed): remove `'join'`, `'lookup'`, `'union'`,
`'upsertsource'` from the IN list; drop `root_refs` from the sum; drop `panel_refs` from the sum. For each, run the
guard spec and record which test(s) went red — the targeted test MUST be red. Restore with `git checkout --` and show
`git diff --exit-code` on the V119 file plus its `sha256sum` equal to base. Recorded in `mutation-runs.md`. While V119 is mutated, run ONLY the embedded-Postgres V119 specs and start no
servers (a changed V119 checksum fails Flyway validation against the shared dev DB).

**D5. Split by seam, keeping the documented class name.** Extract a test-only `trait V119MigrationHarness` (same
package; owns the embedded Postgres, role/template setup, plumbing, seeding, `expectGuardAbort`). Specs:
- `V119OwnerFkCleanupSpec` — the two cleanup tests (orphans removed; clean DB no-op).
- `V119OwnerFkGuardSpec` — the six abort tests + the live-mention negative.
- `V119OwnerFkMigrationSpec` (kept name) — "After V119, inserts and user deletes" (7) + the inventory-doc test, which are
  exactly what `docs/user-reference-inventory.md` lines 10/68, `RlsOwnerTablesSpec:282` and
  `RestSourceConnectorMigrationSpec:221` point at, so every existing reference stays true without touching the doc.
`StoredObjectDeletionsMigrationSpec.scala:18` cites `[[V119OwnerFkMigrationSpec]]` for the Flyway role shape, which
moves into the harness: retarget it to `[[V119MigrationHarness]]` (not in any parked PR). Alternative (four files,
renaming the original) rejected: it would stale the doc references, and the doc is in #994.
Each spec gets its own embedded Postgres (per-suite lifecycle, as today); the extra start-up cost is measured and
reported. Test names are kept verbatim; the executor lists old vs new test names and counts (15 → 17).

## Risks / Trade-offs

- [Slick SQL differs subtly for Option vs non-Option] → D2 parity diff; NOBYPASSRLS test for any delta.
- [Synchronous throw from `UUID.fromString("")`] → D1 defers it into the DBIO; committed failed-Future test.
- [Mutation left in V119 / checksum drift] → D4 restore proof (diff + sha256).
- [Three embedded Postgres instances slower] → measured; per-suite, matches existing pattern.

## Planner Notes

- Self-approved: no new capability; spec delta only restates the V119 guard requirement per reference kind.
- Premise validated against `f63ab8365`: all three items still open; no parked PR touches these files.
