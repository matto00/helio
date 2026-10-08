## Standing Constraints

- [C1] Flyway version is exactly V118 (driver-assigned); if taken on origin/main, stop and escalate.
- [C2] Never apply V118 to the shared dev DB; EmbeddedPostgres only. Dev-DB access is read-only.
- [C3] Prove RLS-safety as a NOBYPASSRLS table-owning role; residual count read over a superuser connection.
- [C4] `sbt testFull`/`testOnly`, never bare `sbt test`; cap parallelism at 3-4, `nice -n 19`; Bash timeout 600000.
- [C5] Implement the owner's map-approximate D1 table exactly; no new format strings, no frontend production change.

### Backend

- [x] 1.1 Write `V118__map_legacy_metric_format_objects.sql`: header with D1 table, D2 codes, ruling, RLS note; D4 bracket
- [x] 1.2 Audit table `hel1410_migrated_output_formats` (D3) with CHECKs; deny-all policy + GRANT helio_privileged + FORCE
- [x] 1.3 DO block implementing D1/D2 (field validity, mapping, unit rule, approximations) + D6 guard; verify by 2.x

### Tests

- [x] 2.1 `V118LegacyMetricFormatMigrationSpec` harness per D7 (real dump, V94-produced objects, role-run, superuser counts)
- [x] 2.2 Edge Outputs covering every D1 branch and D2 code + byte-identical controls; exact configs + audit rows
- [x] 2.3 Validity on the D7 scope only (rewritten rows + string control): string-in-set red pre/green post; KnownKeys; validate Right
- [x] 2.4 Seam fixture `hel1410-v118-expected-configs.json` asserted by the spec + a Jest test via read*Config
- [x] 2.5 Idempotency: re-execute as role (unchanged); re-insert an object and re-run (+1 audit row)
- [x] 2.6 Audit posture (0 as helio, N privileged/superuser) + `RlsPolicyGuardSpec` rlsTables entry
- [x] 2.7 Mutation: remove the outputs NO FORCE bracket → spec red; restore; record transcript
- [x] 2.8 D8: pin V117 spec to 117; update V94OutputsMigrationSpec metric/collection branch (not pinned); grep others; name each
- [x] 2.9 Run migration/persistence suites + FlywayNonSuperuserMigrationSpec + RlsPolicyGuardSpec via testOnly; full gates
