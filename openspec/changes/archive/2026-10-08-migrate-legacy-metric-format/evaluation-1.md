## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `298762df4ddf80c599e5e478254aaf63d84df7dc` (diff base live-resolved: `67f96f5c27e3a483b351f6bad2673ae1df87f0c8`, origin/main).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (measurement): design.md records dev 0/2212 at V116 and 0/2286 at V117, with prod marked owner-only. I re-measured read-only (`default_transaction_read_only=on`): 0 of 2540 outputs. The dev DB's flyway history has 117 and not 118, and `hel1410_migrated_output_formats` does not exist there, so V118 was never applied to the shared DB (C2).
- AC2 / D1 (owner ruling): I checked the migration line by line against the D1 table.
  - L112-120: `decimals` is valid only as a non-negative integer JSON number, so 2.0 counts as 2. Null or absent means absent. Anything else is treated as absent and gets `decimals-ignored`.
  - L125-135: string-only text, trimmed with `btrim(v, E' \t\r\n')`.
  - L142-149: the first-match order is integer, then currency (`$` with decimals absent or 2, prefix consumed), then number. `percent` is never produced.
  - L152-178: the unit-text order is prefix (unless consumed), unit, suffix. The rule for metric versus collection matches D1.
  - The header (L20-40) carries the table verbatim.
- AC3: `unit` is written only when the live `unit` is absent or JSON null (L170). The `m-live-unit` and `m-live-unit-numeric` edges show a non-null live unit is never overwritten.
- AC4 / D3: column shapes and CHECKs match. `prior_unit` keeps absent (SQL NULL) apart from JSON null: the `m-pct-null-unit` edge asserts `Some("null")`. RLS is ENABLE + FORCE + deny-all + `GRANT SELECT TO helio_privileged`, and `RlsPolicyGuardSpec.rlsTables` has the new entry.
- AC5: the spec checks every rewritten row plus the string control. `format` is in the `isMetricFormat` set, red before V118 and green after (spec L173 and L223). Keys are a subset of KnownKeys, and both `validate` calls return Right. The Jest seam test runs the real readers on the same fixture.
- AC6: the spec uses the real `hel904-real-dump.sql`, and V94 itself produces the three dump-derived objects. It runs as a NOSUPERUSER NOBYPASSRLS schema owner, counts residuals over a superuser connection, and checks exact audit rows, unchanged `updated_at`, both idempotency cases, and the audit posture (0 / N / N). I re-did the mutation check myself (see Phase 2).
- D4 order, D5, D6 and D8 match. The V117 spec is pinned to 117. The V94 spec branch is updated rather than pinned. My grep found no further spec that migrates to latest and reads `format` on outputs. `OutputRoutesSpec` matches the grep but creates outputs through the API after migration, so V118 does not affect it.
- C1 to C5 are honoured. V118 is not on origin/main. No frontend production file changed; the only frontend file is a test. No new format strings.
- tasks.md is fully ticked and matches the diff. No scope creep.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH at HEAD 298762df:
- `npm run lint`: clean, zero warnings.
- `npm run format:check`: all files pass.
- `npm test -- --maxWorkers=3`: root 42 suites / 407 tests, frontend 476 suites / 5016 tests, all pass. The new `outputConfigTypes.hel1410` suite has 46 tests, all passing.
- `npm --prefix frontend run build`: exit 0.
- `nice -n 19 sbt testFull`: 6303 succeeded, 0 failed, 4 canceled. The canceled tests are the pre-existing measurement tests gated on `HELIO_MEASURE`, unrelated to this change. The suite included V118LegacyMetricFormatMigrationSpec (log line "pre-V118: 134 outputs, 22 metric/collection with an object format"), V117DeadOutputConfigKeysMigrationSpec, V94OutputsMigrationSpec, RlsPolicyGuardSpec and FlywayNonSuperuserMigrationSpec, all green.
- `npm run check:scala-quality`: clean. It reports only soft warnings, none of which are new hard violations.

Independent mutation check:
- I made a throwaway detached worktree at 298762df, deleted only V118 L55 (`ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;`), and ran `sbt "testOnly ...V118LegacyMetricFormatMigrationSpec"`.
- Result: FAILED, `22 was not equal to 0 (V118LegacyMetricFormatMigrationSpec.scala:181)`. That line is the superuser-side residual count. The migration itself did not throw, which confirms the in-migration guard is blind to a missing bracket and the superuser count is the real backstop, as D6 says.
- I removed the throwaway worktree afterwards (`git worktree list` shows no straggler).

Code quality:
- No inline FQNs. No `any` in the Jest test; the fixture is typed through an `Entry` interface. No dead imports.
- Security: the spec interpolates SQL with literal test IDs only. The migration has no user-input boundary.

### Phase 3: UI Review — N/A
None of the Phase 3 triggers match production code. The only `frontend/**` change is a Jest test file, and no route, schema or OpenAPI spec changed. Nothing user-visible ships in this commit (no production UI code changed).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `V118__map_legacy_metric_format_objects.sql` L183-188: the reorder block, and its comment ("text-shadowed / dropped were appended before joined etc."), are inaccurate and probably redundant. The append order (L160-181) already follows the documented D2 order, because the shadowed, dropped and written branches exclude each other. Harmless, but the comment does not describe what happens. Flyway checksums the file, so only change it before merge, or leave it.
- `V118LegacyMetricFormatMigrationSpec.scala` L279: `cfgOf2` is a weak name for a single-row config reader that sits beside the local `cfgOf`. Something like `liveConfig` would read better.
- Coverage gap, minor: no edge combines `$` with an invalid `decimals` (for example `"2"`). By D1 that should give `currency` plus `decimals-ignored`. The code handles it correctly by inspection, but no test pins it.
- `V117DeadOutputConfigKeysMigrationSpec.scala` L175 comment cites "(L199)". Line-number references go stale. Naming the assertion would be better.
