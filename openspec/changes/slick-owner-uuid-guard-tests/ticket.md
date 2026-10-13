# HEL-1433: After HEL-1347 (V119): Slick ownerId → UUID and drop the dead ownerless branch; add lookup/union guard tests; split V119OwnerFkMigrationSpec

## Description

Origin: HEL-1347 (matto00/helio#879, V119), lane-reported.

1. V119 made `data_sources.owner_id` NOT NULL, but the Slick column is still `Option[UUID]`. Change it to `UUID` and
   remove the now-unreachable ownerless branch in `RestSourceConnectorMigration.scala` (its test was deleted per the
   owner ruling of 2026-10-09).
2. **Guard test gap.** In V119's pre-delete guard, removing `'lookup'` from the op list left every test green. The
   lookup and union step-input clauses have no dedicated test. Add one test per listed op (pipeline root, join, lookup,
   union, upsert target, form panel), each red by mutation. This carries no prod risk (prod had 0 orphans), but the
   guard pattern will be reused.
3. `V119OwnerFkMigrationSpec` is ~413 lines. Split it along its scenario seams.

## Acceptance Criteria

- AC1: `DataSourceRepository`'s Slick `owner_id` column and `DataSourceRow.ownerId` are `UUID` (not `Option[UUID]`);
  every caller compiles against the non-optional type; the `UserId("")` / empty-string-to-None fallbacks are gone.
- AC2: The change is behaviour-preserving: every Slick query over `data_sources` that references `owner_id` emits
  byte-identical SQL before and after (evidence recorded), and the existing NOSUPERUSER/NOBYPASSRLS
  `DataSourceRepository` specs stay green. Any query whose SQL does change is proven under a NOBYPASSRLS role with
  `VerifiedEmbeddedPostgres`.
- AC3: `RestSourceConnectorMigration`'s ownerless (`owner_id IS NULL`) branch and its now-false doc/comment claims are
  removed; `findAllRestApiRawInternal` returns a non-optional owner.
- AC4: V119's guard has one dedicated abort test per reference kind — pipeline root, join, lookup, union, upsertsource
  target, form panel — each shown red by a recorded mutation of exactly that clause (and the V119 file restored
  byte-identically afterwards).
- AC5: `V119OwnerFkMigrationSpec` is split along its scenario seams with a shared test harness; every pre-existing test
  survives under its original name; no doc/comment reference to a spec class name is left pointing at the wrong file.
- Driver constraints: no new migration (V131 reserved by #994); do not touch files in parked PRs #994/#996/#998/#986/#999
  (notably `docs/user-reference-inventory.md` and `RlsPolicyGuardSpec.scala`).
