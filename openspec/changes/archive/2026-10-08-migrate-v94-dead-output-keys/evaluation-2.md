## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed commit:** `78cb938af14eb5bd409b0ee3bbff010a86bbd582` (HEAD). The worktree is clean.
**Diff base:** resolved live, `76816d406e15f10ee1c53431fea801cb18637062`.
**Delta reviewed:** `0fb04b42..78cb938a`. This is cycle 1's PASS plus the folded-in non-blocking suggestions.

### Phase 1: Spec Review — PASS
Issues: none.

- Every cycle-1 finding still holds (see evaluation-1.md). The delta adds no scope creep: it implements the three cycle-1
  suggestions and nothing else.
- The stale "no D9 edits were needed" sentence has been removed from files-modified.md. The cycle-2 section there
  documents the non-object skip and its mutation.
- C1-C4 are still honoured. V117 was only ever applied to EmbeddedPostgres, and I touched no dev DB in this cycle.

### Phase 2: Code Review — PASS
Gates, all run fresh by me at 78cb938a:
- `cd backend && HEL924_TEST_GROUP_COUNT=3 nice -n 19 sbt testFull`: EXIT=0, 6209 succeeded, 0 failed, 4 canceled. The
  canceled tests are the report-only `HELIO_MEASURE` probes. `V117DeadOutputConfigKeysMigrationSpec`,
  `RlsPolicyGuardSpec` and `V94OutputsMigrationSpec` all ran green.
- `node scripts/check-scala-quality.mjs`: clean.
- `node scripts/check-openspec-hygiene.mjs`: clean.

Delta checks:
- **Guard parenthesisation:** correct. It reads `WHERE jsonb_typeof(config) = 'object' AND (A OR B OR C OR D)`
  (V117 lines 158-163). The spec's `DeadWhere` mirrors it with the same grouping.
- **`all_keys`:** unchanged. It still lists `format`, `columnOrder` and `chartOptions` (V117 lines 57-60). The DO-loop
  filter only gained `jsonb_typeof(config) = 'object' AND`.
- **Mutations:** I re-ran these in a throwaway `git archive` copy of 78cb938a under the scratchpad. The executor worktree
  was not touched, and the copy has been deleted.
  - Control (unmutated): the V117 spec passes (1 succeeded).
  - **M-a**, `typeof` removed from the DO-loop filter: Flyway fails with `null value in column "config_value" of relation
    "hel1387_dropped_output_config_keys" violates not-null constraint`, and the spec FAILS. This reproduces the executor's
    transcript, so the `e-array-config` edge Output is load-bearing.
  - **M-b**, my own: the D7 guard's `typeof` replaced with `true`. The migration raises `HEL-1387: 1 outputs rows still
    carry a dead config key after V117`, and the spec FAILS. So the guard's object filter is pinned by the test too.
- **New edge cases:** both assert literal JSON and literal audit tuples.
  - `e-bad-sort` (`"sideways"`) → `invalid-value`.
  - `e-table-format` → `format` dropped as `kind-inapplicable`, `columnOrder` kept.
  - `e-array-config` stays byte-identical, with no audit row.
- **`configs()` change:** it now reads only object configs. This is needed because `json()` would throw on an array. The
  pre/post key-set comparison and the AC7 loop both use the same filtered view. The array row is asserted separately.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `V117DeadOutputConfigKeysMigrationSpec.scala:227` duplicates `a` (line 229) as `a0`. Use `a` and drop `a0`.
- No test pins the D7 parenthesisation itself. If the parentheses were dropped, the `format`/`columnOrder`/`chartOptions`
  clauses would apply to non-object configs. That would only matter for an array config containing those strings on a
  wrong kind (e.g. `["format"]` on a chart), and in that case the guard would raise rather than corrupt data. The current
  form is correct by inspection.
- files-modified.md now has a double blank line where the stale sentence was removed. Cosmetic only.
