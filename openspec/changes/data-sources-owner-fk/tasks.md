## Standing Constraints

- [C1] Owner rulings are fixed: CASCADE FKs on data_sources + image_uploads, orphans and NULL-owner rows deleted in V119; do not re-litigate.
- [C2] Prove V119 as a NOSUPERUSER NOBYPASSRLS table-owning role (V117 spec pattern); superuser-only evidence does not count.
- [C3] Never weaken the new constraints to make a fixture pass; seed a real users row and list every such fixture edit in files-modified.md.
- [C5] Guard tests must be failable by mutation: the root case uses a two-root pipeline (V99 cannot mask it) and asserts the HEL-1347 message.
- [C4] Dev DB rows are touched only by the V119 predicate or by exact id; never by name pattern; never matt@helio.dev.

### Backend

## 1. Backend — V119 migration

- [x] 1.1 Re-verify V119 is free on origin/main and every remote branch/worktree immediately before creating the file
- [x] 1.2 Create `V119__data_sources_image_uploads_owner_fk.sql` with a header comment (HEL-1347, owner rulings, RLS rationale)
- [x] 1.3 NO FORCE ROW LEVEL SECURITY on data_sources, image_uploads, pipeline_roots, pipeline_steps, panels at the top (D2)
- [x] 1.4 Guard (D3): target ids into a text[]; RAISE with per-kind counts if any root/step/form-panel reference hits a target
- [x] 1.5 Delete NULL/orphan-owner data_sources and orphan image_uploads, RAISE NOTICE each count (D4)
- [x] 1.6 SET NOT NULL on data_sources.owner_id; add data_sources_owner_id_fkey and image_uploads_owner_id_fkey ON DELETE CASCADE
- [x] 1.7 Re-enable FORCE ROW LEVEL SECURITY on all five tables at the bottom
- [x] 1.8 Grep main code for any path that can insert a NULL/empty data_sources owner; escalate if one exists (Planner Notes)

## 2. Docs

- [x] 2.1 Write `docs/user-reference-inventory.md`: FK table, non-FK/indirect refs, cascade reach + gaps (D6), audit_events residue
- [x] 2.2 Link it from `docs/README.md`

### Tests

## 3. Tests

- [x] 3.1 Add `V119OwnerFkMigrationSpec` (NOBYPASSRLS role, migrate 118 → seed via superuser → migrate 119 → assert over superuser)
- [x] 3.2 Scenario: orphaned + NULL-owner sources (with dataset_rows) and orphan image uploads deleted; owned rows + dataset_rows survive; FORCE on all 5 tables
- [x] 3.3 Guard scenarios (D7): two-root pipeline; join secondaryInput; upsertsource target; form panel — each HEL-1347 message, zero deleted
- [x] 3.4 Scenario: clean DB → V119 deletes nothing, both constraints present
- [x] 3.5 Scenarios: insert with non-existent owner (23503) / NULL owner (23502) rejected; image upload non-existent owner (23503)
- [x] 3.6 User delete (D7, lane length pinned each): sources/images cascade; own pipeline, 1-step & 2-step cross-owner rejected intact; multi-root reach; connector
- [x] 3.7 Assert the users-referencing FK set in a migrated DB equals the set parsed from docs/user-reference-inventory.md
- [x] 3.8 Mutations: drop pipeline_roots/panels bracket; drop data_sources bracket; drop each clause; drop panels closing FORCE — each red
- [x] 3.9 Fix fixtures broken by the new FK/NOT NULL by seeding real users (C3); run `sbt testFull` (nice -n 19) green
- [x] 3.10 Real-dump specs per D7: restructure FlywayNonSuperuserMigrationSpec; pin V94Outputs/DatasetRowsReaderBehaviorPreserving to 118
- [x] 3.10a Audit the other 4 unpinned real-dump specs (V96, V106, V118, SchemaFieldRealDumpInvariant) for post-latest source/row assertions; pin or justify
- [x] 3.11 Only once V119 is final: apply to the shared dev DB; record pre/post orphan counts measured at that moment (no hard-coded numbers)
