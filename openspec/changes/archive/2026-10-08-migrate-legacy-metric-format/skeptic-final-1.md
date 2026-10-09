## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `298762df4ddf80c599e5e478254aaf63d84df7dc`. The diff base was resolved live with `resolve-review-base.sh`: `67f96f5c`. origin/main is one commit ahead (06a4eb97, HEL-1402). That commit adds no migration. V118 is still free on origin/main, where the highest migration is V117, and no open PR claims it.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/migrate-legacy-metric-format/HEL-1410`.
- **AC1 (measurement):** design.md records the dev counts: 0/2212 at V116 and 0/2286 at V117. The evaluator re-measured 0/2540 read-only. The prod count is flagged owner-only.
- **AC2 / D1 (owner ruling map-approximate), implemented exactly.** I read V118 line by line against the D1 table.
  - `decimals` validity, L112-120: a non-negative integral JSON number. Null or absent counts as absent. Anything else sets `decimals-ignored`.
  - Text fields, L125-135: strings only, trimmed with `btrim(.., E' \t\r\n')`. An empty result counts as absent. A non-string sets `text-ignored-non-string`.
  - Unknown keys, L137.
  - First-match rules, L142-149: integer, then `$` currency with the prefix consumed, then number. `percent` is never produced.
  - Unit-text parts, L152-155: prefix unless consumed, then unit, then suffix, joined by a single space.
  - Collection / no-text / shadowed / written branches, L165-178. These match D1.
  - The header (L20-40) carries the table verbatim.
- **AC3:** `unit` is written only when it is absent or JSON null (L170, L195-197). The `m-live-unit` and `m-live-unit-numeric` edges assert that a non-null unit, string or numeric, is left untouched.
- **AC4 / D3:** The audit table's shape, CHECKs and `prior_unit` absent-vs-null handling all match. `m-pct-null-unit` asserts `Some("null")`. RLS is ENABLE + FORCE + deny-all + `GRANT SELECT TO helio_privileged` (L220-225), and `RlsPolicyGuardSpec.rlsTables` gained the entry.
- **AC5:** Non-vacuous red/green, both in the spec:
  - Pre-V118, `formatInSet` is false for every rewritten row (L173). Post-V118 it is true (L223).
  - Keys are a subset of `KnownKeys`, and `validate` returns Right.
  - Seam: the Scala spec asserts the DB against `hel1410-v118-expected-configs.json` (L229-242). The Jest test feeds the same file through the real `readMetricConfig`/`readCollectionConfig` and asserts exact format/unit equality. It also asserts `format: null` for the original V94 objects.
- **AC6 (proof standard):**
  - Real `hel904-real-dump.sql`, and V94 itself produces the three dump-derived objects (L114-134).
  - NOSUPERUSER NOBYPASSRLS schema owner, asserted from `pg_roles` (L110).
  - Superuser-side residual count of 0 (L181). Exact audit rows on all columns except `logged_at`, with the approximation order compared as a Vector. `updated_at` unchanged.
  - Two idempotency cases: a clean re-run, and a re-run after putting one object back, which adds exactly one row (L244-261).
  - Audit posture is 0 / N / N (L263-272).
  - Mutation red: I relied on the evaluator's own transcript. It deleted L55 in a throwaway worktree and the spec failed with `22 was not equal to 0 (…:181)`. It is specific and consistent with the spec, so I did not re-mutate. I am read-only.
- **D8 existing-spec changes:** V117's spec is pinned to 117. The metric/collection branch of V94OutputsMigrationSpec now asserts a string format plus the audit `original_format`, and its comment admits the dump never exercises that branch.
- **Gates re-run by me at 298762df:**
  - `nice -n 19 sbt "testOnly V118LegacyMetricFormatMigrationSpec V117DeadOutputConfigKeysMigrationSpec V94OutputsMigrationSpec RlsPolicyGuardSpec FlywayNonSuperuserMigrationSpec"`: 5 suites, 155 tests, 0 failed. They ran live: EmbeddedPostgres logs carry the current timestamp, plus "pre-V118: 134 outputs, 22 metric/collection with an object format".
  - `npx jest outputConfigTypes.hel1410`: 46/46 pass.
  - For the full suite I relied on the evaluator's pasted sbt testFull and npm lint/format/test/build results.
- **Shared dev DB:** this gate never touched it. Everything above ran on EmbeddedPostgres.
- **UI:** N/A. There is no production frontend change; the only frontend file is a Jest test.

### Verdict: REFUTE

V118 is behaviourally correct and the proof standard is fully met. The one defect is a comment in V118 that is false. V118 is a prod-data Flyway migration, and once applied its checksum, comments included, freezes the file for good. The only window to correct the comment is before merge, and the fix is a few lines. The orchestrator asked me to rule on it, and leaving a false statement in a file that can never be edited does not meet CONTRIBUTING.md's comment standard ("the restatement silently stops being true"; here the comment is untrue from day one).

### Change Requests

1. **`backend/src/main/resources/db/migration/V118__map_legacy_metric_format_objects.sql` L183-188.** The comment "Reorder `approx` into the documented order (text-shadowed / dropped were appended before joined etc.)" is false, and the block it justifies does nothing.
   - **Why the comment is false.** The appends happen in this sequence:
     - L161: `decimals-capped` or `decimals-not-fixed`
     - L163: `decimals-ignored`
     - L165-178: an IF/ELSIF chain with mutually exclusive branches. At most one of these is appended: `text-dropped-collection`, `text-shadowed`, or `prefix-after-value` followed by `text-joined`.
     - L180: `text-ignored-non-string`
     - L181: `unknown-keys-ignored`

     That is already exactly the documented D2 order, so `text-shadowed`/`text-dropped-collection` can never be appended in the same row as `text-joined`. That is what the comment claims happens.
   - **Required action (pick one), then re-run `V118LegacyMetricFormatMigrationSpec`:**
     - (a) Delete L183-188. The exact-order Vector assertions in the spec (e.g. `m-joined`, `real-metric-dump`) still pin the order.
     - (b) Keep the block, but replace the comment with a true one. For example: "Defensive normalisation to the documented order; the appends above already follow it because the unit-text branches are mutually exclusive."
   - **Constraints:** do not change any mapping behaviour, and keep V118 as the version.

### Non-blocking notes

- **`$` with invalid `decimals` (e.g. `{"prefix":"$","decimals":"2"}`).** The code gives `currency` plus `{decimals-ignored}`. That follows D1 exactly ("any other value is treated as absent", L117-118 then L144). It is untested but composes trivially. Prod V75 data was written from `MetricFormat(decimals: Option[Int])`, so a non-integer `decimals` cannot exist there. It is worth adding one edge while the spec is open for CR1 anyway, but this is not required.
- **Unparseable non-number `decimals`, e.g. `"two"`.** L113-115 relies on the AND short-circuiting before the `::numeric` cast. PL/pgSQL simple expressions are evaluated without constant-folding variables, and V75 data can never hold this. Even if the cast were evaluated, the migration would fail loudly rather than silently. No action.
- **Fixture comment.** The `comment` in `hel1410-v118-expected-configs.json` says "`ref` entries starting with 'real-'", but the field is `id`. It is a test file, so it can be fixed any time.
- **Evaluator's other notes.** The `cfgOf2` naming and the `(L199)` line reference in the V117 spec comment are fine to leave or tidy. Test files are not checksum-frozen.
