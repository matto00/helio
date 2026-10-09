## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `d30f1c5af9fbe0ceed5d7f77f5f4a2e4a80a2f09`. I resolved the diff base live with `resolve-review-base.sh`, which gave `67f96f5c`. origin/main is at 06a4eb97 (HEL-1402). That commit touches only pipeline/patch-set Scala, tests and openspec archive files, so it adds no migration. The highest migration on origin/main is still V117, and no open PR claims V118. `git merge-tree HEAD origin/main` merges cleanly.

### What I verified (with evidence)
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/migrate-legacy-metric-format/HEL-1410`.
- **CR1 from round 1 is fixed (option a).**
  - `git show HEAD` shows exactly 7 deleted lines: the false "Reorder `approx`..." comment and the `approx := ARRAY(SELECT ... unnest ...)` block.
  - No mapping line changed.
  - The appends still run in the documented order:
    - L161 decimals-capped/not-fixed
    - L163 decimals-ignored
    - L165-178 the mutually exclusive collection/no-text/shadowed/written branches, with prefix-after-value then text-joined
    - L180 text-ignored-non-string
    - L181 unknown-keys-ignored

    The header's code table (L35-40) gives the same order when read row by row. The spec's exact-Vector assertions pin it, for example the `real-metric-dump` row `Vector("decimals-not-fixed","prefix-after-value","text-joined")`.
- **V118 re-read in full as immutable text (L1-220).**
  - The header is accurate against the code, including:
    - decimals validity
    - btrim set
    - first-match mapping, where an invalid `decimals` counts as absent and so `$` maps to currency
    - unit-text order and join
    - absent-vs-null `prior_unit`
    - the rollback recipe
    - the RLS bracket rationale
    - the idempotency claim
  - Nothing in V118 references the removed block.
  - Bracket: L55 NO FORCE on `outputs`, L220 FORCE.
  - Audit table: ENABLE + FORCE + deny-all + `GRANT SELECT TO helio_privileged`. This is the same posture and the same role as V117, which is already merged.
- **Round-1 non-blocking notes were also taken up.**
  - New edge `m-currency-dec-string` (`{"prefix":"$","decimals":"2"}` gives currency and `[decimals-ignored]`, with no unit). It is in both the spec's `Edges` and the seam fixture.
  - The fixture comment now says `id`.
  - The stale "(L199)" in the V117 spec is gone.
- **AC1-AC5 and D1 (map-approximate) are unchanged since round 1.**
  - Behaviourally, the round-1 trace still holds line for line. The only V118 delta is the removed no-op, and the removed block was a stable filter over a fixed list, so the output is the same whenever the input was already in order.
  - Seam: the Scala spec asserts the migrated DB against `hel1410-v118-expected-configs.json`. The Jest test runs the same file through the real `readMetricConfig`/`readCollectionConfig`, and checks that the reader drops the original object (`null`).
- **AC6 proof standard, re-checked in the spec source.**
  - Real `hel904-real-dump.sql`, with V94 itself producing three object formats.
  - `pg_roles` asserts `(false,false)` for the migrating role.
  - Superuser residual count of 0.
  - Exact audit rows.
  - `updated_at` unchanged.
  - Pre-V118, the `formatInSet` check is red for every rewritten row; post-V118 it is green, with `KnownKeys` subset and `validate` returning Right.
  - Two idempotency cases (a clean re-run, and putting one object back, which adds +1 row).
  - Audit posture 0 / N / N, and both tables have relforcerowsecurity = true.
  - Mutation red: evaluation-1.md records deleting L55, after which the spec fails with `22 was not equal to 0 (...:181)`, the superuser residual count. Cycle 2 did not touch the bracket, the guard or that assertion, so that evidence still applies. I did not re-mutate because I am read-only.
- **Fresh gates at d30f1c5a (run by me, because the executor did not re-run the full suite after cycle 2):**
  - `nice -n 19 sbt testFull`, EmbeddedPostgres only: **6303 succeeded, 0 failed, 4 canceled, 0 aborted, 448 suites, EXIT=0**.
    - The 4 cancellations are the opt-in `HELIO_MEASURE=1` measurement specs, which is expected.
    - V118LegacyMetricFormatMigrationSpec passed live, logging `pre-V118: 135 outputs, 23 metric/collection with an object format`. In round 1 the figures were 134/22, so the new edge is counted, which shows the run was fresh rather than cached.
    - V117DeadOutputConfigKeysMigrationSpec, V94OutputsMigrationSpec and RlsPolicyGuardSpec all passed in the same run.
  - `npx jest outputConfigTypes.hel1410`: 48/48 passed. In round 1 it was 46; the new entry adds 2 tests.
- **Shared dev DB:** this gate never touched it.
- **UI:** N/A. There is no production frontend change; the only frontend file is a Jest test. Servers were not started.

### Verdict: CONFIRM

### Non-blocking notes
- **V118 cosmetics (frozen once applied, but harmless):**
  - The column alignment is irregular at L81 (`dec_val        NUMERIC;`) and L97 (`has_unknown    BOOLEAN;`), and there is a stray blank line at L98.
  - The guard message reads "% metric/collection outputs rows still carry...", where "outputs rows" is clumsy.
  - None of these is a false statement. Fixing them is optional before merge.
- **Merge/release:** AGENT_MERGE is false, as briefed. Prod runs V118 over real data, so the prod count of object formats (AC1) stays owner-only.
