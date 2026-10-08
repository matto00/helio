## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `78cb938af14eb5bd409b0ee3bbff010a86bbd582` (worktree clean apart from the untracked evaluation-2.md).
Diff base, resolved live: `76816d406e15f10ee1c53431fea801cb18637062`. origin/main is at 9fbdd426 (HEL-1310). It has no
migration overlap, `git merge-tree HEAD origin/main` is clean, and V117 is not taken on origin/main (C1 holds).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/migrate-v94-dead-output-keys/HEL-1387`.
- **AC1 (mapping table in the header):** V117 lines 7-21 hold the full D1 table, including the Q3 wrong-kind rows.
- **Mapping matches the live contract:** I checked against `OutputConfigValidation.KnownKeys` (lines 21-28).
  - `format` is accepted only by metric and collection. V117 line 87 skips it there, and guard line 161 matches.
  - `columnOrder` is accepted only by table and `chartOptions` only by chart (lines 90, 93).
  - Every rename target (`label`/`unit`/`annotation`/`layout`/`sort`) is in its kind's KnownKeys.
  - The V94 §9 writer (V94 lines 746-757 and 707) emits exactly the keys V117 enumerates, plus `fieldMapping` (Shared).
- **Readers:** I grepped frontend/src, helio-mcp/src and backend main for every dropped key. The only hits are local
  variable names in the output editor, comments, and panel `appearance.chart` (`seriesColors`/`axisLabels`). No code
  reads any dropped key from Output config, which confirms task 1.4.
- **AC3 (never overwrite a live key) and the D2 precedence:**
  - The DO block applies kind-inapplicable, then no-live-equivalent, then null-value, then invalid-value, then
    shadowed-by-live (non-null live only, line 128), then renamed.
  - A JSON-null live key is filled, per Q1.
  - It writes one audit row per removed key with `v = r.config -> k`, the full original value. `live_key` is set only
    on `renamed`.
  - The spec pins this with `e-live-wins`, `e-null-live` and the exact per-Output audit sets.
- **AC4 (drops):** asserted exactly, for the real hel904 Outputs (expected configs and audit sets built independently by
  `expectedAction`) and for the edge Outputs.
- **AC5 (real fixture):** the spec loads `hel904-real-dump.sql` at V93 and sets the legacy panel columns, so V94 itself
  writes the dead keys. It also binds `metric_id` on one chart panel and one metric panel for Q3.
  - My fresh run printed: `pre-V117: 127 outputs, 71 with dead keys; hel904 kinds (collection 5, metric 13, chart 10,
    timeline 6, table 21, markdown 2)`.
  - All six kinds go through the real V94 path, so the collection-layout and timeline-sort renames are exercised from
    real V94 output, not only from hand-built rows.
- **AC6 (RLS-safety), reproduced by me:**
  - The chain runs as `NOSUPERUSER NOBYPASSRLS` schema owner `helio_migration_test`, and the spec asserts the role
    flags at line 91. Dead keys are counted over the superuser connection.
  - Control: a throwaway `git archive` copy of HEAD under the scratchpad, with a comment-only cache-bust to the spec so
    sbt 2 cannot replay a cached result. Output: `Tests: succeeded 1, failed 0`, `1 onsite task` (it really executed).
  - Mutation: the same copy with only `ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;` removed (diff: line 37).
    Flyway migrate did not throw; it succeeded silently. The spec FAILED at
    `71 was not equal to 0 (V117DeadOutputConfigKeysMigrationSpec.scala:180)`, which is the superuser backstop.
  - So the bracket is load-bearing and the test would catch its absence. Both copies were deleted afterwards. The real
    worktree was never mutated.
  - The bracket is safe in prod. Flyway runs Postgres migrations in one transaction, and `ALTER TABLE` holds an ACCESS
    EXCLUSIVE lock, so no other session can observe the NO FORCE window. It is the same pattern as V94 §0/§22 and V112.
- **D4 audit-table posture:**
  - It mirrors V105 `oauth_states`: ENABLE + FORCE, a `USING (false)` deny-all policy, and an explicit
    `GRANT SELECT ... TO helio_privileged`.
  - The spec asserts 0 rows as the role (with `app.current_user_id` set), N rows under `SET ROLE helio_privileged` and
    N as superuser. `relforcerowsecurity` is restored on both tables.
  - The audit table is NO FORCE in-bracket, so a re-run's inserts by the owner work.
  - `RlsPolicyGuardSpec` gains the table entry.
- **AC2 (idempotency):**
  - The spec re-executes the V117 file as the role and asserts that configs, audit rows and audit count are unchanged.
  - Re-adding `metricLabel` and re-running renames it and appends exactly one audit row.
  - `updated_at` is asserted unchanged across V117.
- **AC7 (round-trip validation):**
  - For every post-V117 object config, the spec asserts `keys ⊆ KnownKeys`, `validate(kind,cfg,{})` is Right and
    `validate(kind,cfg,cfg)` is Right.
  - Non-vacuity: the first two are asserted to fail on the pre-V117 configs (lines 171-172).
- **Non-object config hardening:** `e-array-config` stays byte-identical with no audit row. The evaluator's M-a/M-b
  mutations are documented, and the logic checks out by inspection (loop and guard both filter
  `jsonb_typeof(config)='object'`).
- **Target-version specs:** `V117…Spec`, `RlsPolicyGuardSpec`, `V94OutputsMigrationSpec` and
  `FlywayNonSuperuserMigrationSpec` all pass: `Tests: succeeded 151, failed 0`, EXIT=0. That run reported `cache 100%`,
  so I treat it as corroborating only. The fresh, cache-busted control above is my load-bearing run.
  - I rely on the evaluator's pasted fresh `testFull` (EXIT=0, 6209 succeeded) for the full suite. It is pasted with an
    exit code and is unambiguous.
- **D9 edit (`V94OutputsMigrationSpec`):** this is a genuine contract change. That spec migrates to latest, and V117
  drops chart/table/timeline/markdown `format` per Q3. The assertion stays strict both ways: metric and collection must
  match byte-for-byte, and the other kinds must have no `format`. The edit is named in files-modified.md.
- **AC8 (dev-DB counts):** I ran my own read-only query (`default_transaction_read_only=on`) against
  localhost:5432/helio, which is at V116 with 2212 Outputs.
  - Dead keys present: `timelineOptions`/timeline = 1 and `format`/chart = 1. Every other dead key is 0.
  - Live occurrences, not affected: `columnOrder`/table 125, `chartOptions`/chart 3, `format`/metric 13.
  - Non-object configs: 0.
  - This matches files-modified.md exactly. It still has to appear in the PR body (see the notes below).
- **No UI changes**, so step 4 (visual judgment) does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- **AC8 is a delivery-step obligation.** The PR body must carry the per-dead-key dev-DB counts above, with prod
  counts marked owner-only. Please verify this before merge, because no PR exists yet.
- **Leftover helper.** `V117DeadOutputConfigKeysMigrationSpec.scala` lines 222-227 call `a0` before it is defined, and
  it duplicates `a` (line 229). Collapse it into `a`.
- **Follow-ups not yet filed.** Task 3.1 is still unfiled: RestorePriorStored dead-key normalisation, and the metric
  `format` object-vs-string issue. File both at delivery.
- **No gate defect.** No mtime-ordering evidence was relied on by me or the evaluator.
