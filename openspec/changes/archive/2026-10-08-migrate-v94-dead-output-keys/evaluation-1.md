## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `0fb04b42a7bd6278f9a6847829e4914bfce719ab` (HEAD; tree clean). Diff base resolved live:
`76816d406e15f10ee1c53431fea801cb18637062` (merge-base with origin/main `6caba6b1`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: `V117__migrate_v94_dead_output_config_keys.sql` carries the full D1 dead→live mapping table in its header. **C1**: V117 is
  not taken on origin/main (latest there is V116). PASS.
- AC2 (idempotent): the spec re-runs the V117 file as the role on migrated data. Configs, audit rows and audit row count are
  unchanged. A re-add case (`metricLabel` put back on `e-readd`) re-runs cleanly: it renames to `label` and appends exactly
  one audit row. PASS.
- AC3 (never overwrite a live key): `e-live-wins` keeps `layout: "grid"` and is audited `shadowed-by-live`. `e-readd` keeps
  `unit`. Null-is-absent (Q1) is covered by `e-null-live` and `e-sort`. PASS.
- AC4 (drop no-equivalent keys): `e-legend` covers legend/tooltip/seriesColors/axisLabels. The real-dump Outputs cover
  columnWidths/tableDensity. PASS.
- AC5 (real pre-V94 fixture): uses `hel904-real-dump.sql`. Legacy panel columns are set so that V94 itself writes the dead
  keys. That gives 69 Outputs with dead keys across all six kinds (collection 5, metric 13, chart 10, timeline 6, table 21,
  markdown 2), so the collection→layout and timeline→sort renames are exercised on real V94 output. PASS.
- AC6 (RLS-safe as non-superuser, NOBYPASSRLS, table-owning role): the role shape is asserted via `pg_roles`. Dead keys are
  counted over a superuser connection. **C3** honoured. PASS.
- AC7 (non-vacuous): before V117, the spec asserts that both `keysOk` and `validate(kind,cfg,{})` fail on some config.
  After V117, it asserts that keysOk, `validate(kind,cfg,{})` and `validate(kind,cfg,cfg)` are all Right for every Output.
  PASS.
- AC8: I re-ran the dev DB measurement myself, read-only (`BEGIN READ ONLY`). It has 2212 Outputs. The only dead keys are
  `timelineOptions` on a timeline (1) and `format` on a chart (1). Every other dead key is at 0, and no config is a
  non-object. This matches files-modified.md. The dev DB is still at V116 and `hel1387_dropped_output_config_keys` is
  absent (**C2** honoured). Whether the PR body reports these counts is checked at Delivery.
- D2 action precedence: the migration checks the six no-live-equivalent keys before the kind test. D2 says those keys are
  never `kind-inapplicable`, so this ordering is equivalent. For rename sources the order is kind → null (including an
  absent or null nested `layout`/`sort`) → shape → shadowed → renamed, which matches D2 1-6 exactly. `live_key` is set only
  for `renamed`. `config_value` is `config -> key`, i.e. the whole original object for collectionOptions/timelineOptions.
- D5 bracket order matches the design: NO FORCE outputs → CREATE IF NOT EXISTS → NO FORCE audit → DO → guard →
  ENABLE/FORCE + policy + grant → FORCE outputs. There is no `app.current_user_id` and no BYPASSRLS.
- `format`/`columnOrder`/`chartOptions` acceptance in the migration and guard (`format` on metric/collection,
  `columnOrder` on table, `chartOptions` on chart) matches `OutputConfigValidation.KnownKeys`
  (OutputConfigValidation.scala:21-28).
- `updated_at` is untouched: the spec compares it before and after.
- C1-C4 are all honoured.

### Phase 2: Code Review — PASS
Gates, all run fresh by me:
- `cd backend && HEL924_TEST_GROUP_COUNT=3 nice -n 19 sbt testFull`: EXIT=0, 6209 succeeded, 0 failed, 4 canceled. The
  canceled tests are the report-only `HELIO_MEASURE` timing probes. `V117DeadOutputConfigKeysMigrationSpec`,
  `RlsPolicyGuardSpec`, `V94OutputsMigrationSpec` and `FlywayNonSuperuserMigrationSpec` all ran green.
- `node scripts/check-scala-quality.mjs`: clean (soft size warnings only).
- `node scripts/check-openspec-hygiene.mjs`: clean.
- No frontend files changed, so the frontend gates do not apply.

Mutation evidence, which I re-ran myself in a throwaway `git archive` copy of the backend in the scratchpad (the executor
worktree was not touched; the copy is deleted):
1. Commenting out `ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;` → Flyway reports "Successfully applied 1
   migration". The in-migration guard did not fire, which confirms D7's blindness. The spec went red:
   `69 was not equal to 0 (V117DeadOutputConfigKeysMigrationSpec.scala:177)`. This reproduces the executor's transcript.
2. My own extra mutation: removing the null-is-absent rule (`IF live_val IS NOT NULL THEN`) → spec red at :202:
   `{"annotation":null,...} was not equal to {"annotation":"Q3 dip",...}`.

Test independence: `expectedAction` and the `kept ++ renamed` config expectation are written from the D1/D2 contract and
read from the pre-V117 config. The edge Outputs assert literal JSON and literal audit tuples. Nothing is derived from the
migration's own output. `auditRows` returns a Set, which could hide duplicate rows, but the separate `count(*) ==
allAudit.size` check closes that gap.

V94OutputsMigrationSpec edit: `beforeAll` migrates to **latest** (V94OutputsMigrationSpec.scala:237-242, no target), so
V117 legitimately removes `format` from non-metric/collection kinds. This is a D9 contract change, not a fixture tweak to
make the test pass:
- The metric/collection branch still asserts byte equality.
- The chart branch asserts that `format` is absent.
- That V94 itself writes `format` onto a chart is now pinned in the V117 spec (`chartFormatPre should not be empty`).

RlsPolicyGuardSpec: the new entry uses the exact policy-name set for `hel1387_dropped_output_config_keys`. The audit table's
posture is asserted: 0 rows for the owner role with app context set, N rows under `SET ROLE helio_privileged` and for the
superuser, and FORCE RLS restored on both tables.

No dead code, no inline FQNs, no over-engineering.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files changed. The only spec delta is under
`openspec/changes/...`, which is not a trigger path.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `files-modified.md` contradicts itself. Its line "No pre-existing spec asserted a dead key after migrating to latest, so
  no D9 edits were needed" is followed later by the V94OutputsMigrationSpec D9 entry. Delete the stale sentence before
  delivery so the PR body is not built from it.
- Robustness, not a defect: `outputs.config` has no `jsonb_typeof = 'object'` CHECK. A non-object config holding a string
  element that equals a dead key name would make `config -> k` NULL, and the audit INSERT would fail loudly on
  `config_value NOT NULL`. The dev DB has 0 non-object configs and the app writes only objects. If you want to be safe for
  prod, the DO block's SELECT could add `AND jsonb_typeof(config) = 'object'`. Because V117 has not been applied anywhere,
  the file can still be edited.
- Edge coverage that could be added: an invalid `timelineOptions.sort` (e.g. `"up"`), and `format` dropped on a
  table/timeline Output. Both are on the same code paths as cases already covered.
