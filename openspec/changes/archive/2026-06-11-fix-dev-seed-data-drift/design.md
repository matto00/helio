## Context

`DemoData.scala` seeds only dashboards and panels (both owned by `SystemUserId`). DataTypes, DataSources, and Pipelines were historically created outside DemoData — either by earlier iterations of the seed code that were removed, or by ad-hoc manual inserts. Ground-truth DB inspection (2026-06-11) revealed **four distinct drift issues**:

1. **Six pre-V15 DataType rows with `owner_id IS NULL`**: V14 and V15 added `owner_id` columns as nullable ALTERs with no backfill. Rows that existed before V15 have NULL owner and are invisible to every authenticated user (since `DataTypeRepository.findById(typeId, ownerId)` filters `WHERE owner_id = ?` and NULL never matches). Confirmed rows: `Helio Dashboards`, `NetflixCSV`, `test static`, `Netflix Data`, `TestDataNetflix`, `MyManualSource`.

2. **ProfitAgg output DataType owned by wrong user account**: The DataType `c1005183-..` ("Profit") is owned by `0632ca2e-...` (matt's Google OAuth account, `mattheworr018@gmail.com`), not `9532cfcf-...` (matt's primary dev account, `matt@helio.dev`). When matt logs in via the dev credentials, `PanelService.resolveSingleBinding` calls `dataTypeRepo.findById(typeId, user.id)` with `9532cfcf-...`, returns None, and silently scrubs the binding.

3. **ProfitAgg join step has empty config — `rightDataSourceId` defaults to `""`**: The join step's `config` column stores `{}`. `JoinConfig.decode` tolerates missing keys, so `rightDataSourceId` defaults to `""`. At run time, `JoinStep.evaluate` calls `ctx.dataSourceRepo.findByIdInternal("")` which returns None, raising `"DataSource not found for join"` → 422. The correct right-side DataSource is the `Profit` static DataSource (`339018f2-3760-415d-baeb-35d2e3061992`, named "Profit").

4. **ProfitAgg pipeline itself is owned by SystemUser**: V32 backfilled pre-existing pipelines to `SystemUserId` (`00000000-...-0001`). Matt's dev account (`9532cfcf-...`) can't see or run the pipeline via the ACL-enforced routes.

Both problems 2 and 4 are facets of the same underlying issue: seeded/migrated data that doesn't match what the current ACL model expects for the primary dev user (`matt@helio.dev`).

## Goals / Non-Goals

**Goals:**
- Provide a one-shot SQL repair script that fixes all four broken-state issues in the existing dev DB
- Update `backend/README.md` with the repair procedure and context about SystemUser-owned seed data
- Leave Flyway migrations untouched

**Non-Goals:**
- Modifying Flyway migrations (V14/V15/V32 are historical; changing them would break checksum validation)
- Fixing the ACL check on `PATCH /api/panels/:id` (out of scope, separate ticket)
- Production data migration (dev-only scope)
- Changing `DemoData.scala` (it only seeds dashboards/panels which use SystemUserId — pre-existing behavior, not a blocker for this ticket's ACs)

## Decisions

### Decision 1: Repair script, not a new Flyway migration

Options: (a) new Flyway migration (e.g. V39) that backfills NULL owners; (b) a standalone SQL script not run by Flyway.

Chose (b). A Flyway migration that backfills with a hardcoded user UUID would embed dev-specific UUIDs in a migration file that runs in CI and production. The repair is dev-DB-only and is inherently one-shot — once applied to a drifted installation the problem doesn't recur. An idempotent SQL file in `backend/scripts/` is the right tool: it can be inspected, re-run safely, and never touches a prod schema.

### Decision 2: Target user is `9532cfcf-9882-45ba-8247-23706bc00113` (matt@helio.dev)

The primary dev login documented in the project memory is `matt@helio.dev / heliodev123` with UUID `9532cfcf-9882-45ba-8247-23706bc00113`. This is the user whose panel bindings were scrubbing and whose pipeline run was 422-ing. All four ownership repairs target this UUID.

### Decision 3: Fix ProfitAgg join step by setting `rightDataSourceId` to the `Profit` static DataSource

DB inspection confirms the join step config is `{}` (tolerant decoder defaults `rightDataSourceId` to `""`). The intended right-side source is the `Profit` static DataSource (`id: 339018f2-3760-415d-baeb-35d2e3061992`, `name: "Profit"`), which contains the expense/revenue columns the pipeline computes against. The repair script will UPDATE the join step's `config` column to `'{"rightDataSourceId":"339018f2-3760-415d-baeb-35d2e3061992","joinKey":"month","joinType":"inner"}'`. The `joinKey` and `joinType` defaults are `month` (the shared key between HelioProfit CSV and Profit static source) and `inner`.

**Planner Note:** The `joinKey` value `month` is inferred from the pipeline's field names (`revenue_usd`, `expenses_usd` are renamed, and `month` appears in the SELECT step). If the executor finds a different joinKey in the Profit DataSource schema, they should prefer that over `month`. The joinKey is best verified by querying the Profit DataSource's field list at repair time and matching it to the HelioProfit CSV schema.

### Decision 4: DemoData.scala requires no change

DemoData currently seeds only dashboards and panels with SystemUserId. These are pre-existing behavior and are not causing any of the four identified issues. Any future addition of DataTypes, DataSources, or Pipelines to DemoData must assign `owner_id` to a real user — this is documented in `backend/README.md` as a code comment requirement (not a runtime spec scenario, since no code change implements it here).

## Risks / Trade-offs

- [Risk] Repair script hardcodes UUIDs specific to matt's dev DB → Mitigation: script includes guarded DO blocks that SELECT the target UUIDs first and no-op if the rows don't exist; documented as dev-only in README.
- [Risk] `joinKey: "month"` may not be the correct join key if the Profit static DataSource uses a different column → Mitigation: documented as requiring executor verification against actual DataSource field names; executor should query the Profit DataSource config to confirm.
- [Risk] Future contributors may create new DataTypes/DataSources in DemoData and hit the same ownership drift → Mitigation: README note explicitly calls out the SystemUserId constraint and directs future contributors to use real user IDs.

## Migration Plan

1. Run `psql $DATABASE_URL -f backend/scripts/repair-dev-db.sql` from the repo root.
2. Restart the backend — no Flyway migration required.
3. Verify each AC: (a) `POST /api/pipelines/<profitagg-id>/run` returns non-422; (b) binding a panel to the "Profit" DataType (id: `c1005183-...`) persists across read; (c) `SELECT owner_id FROM data_types WHERE owner_id IS NULL` returns 0 rows.
