### Backend

- [x] 1.1 Re-derive the full RLS-enabled table set: `grep -rl "ENABLE ROW LEVEL SECURITY" backend/src/main/resources/db/migration | sort`, cross-check every result against `rlsTables`, and confirm (in a code comment or commit note) that `audit_events`/`connector_credentials` are the only two gaps
- [x] 1.2 Refactor `rlsTables: Set[String]` into a structure that carries an optional expected-policy-name set per table (e.g. `Map[String, Option[Set[String]]]`), preserving every existing entry's comment and behavior (`None` = today's `count > 0` check, unchanged)
- [x] 1.3 Add `audit_events -> Some(Set("audit_events_owner", "audit_events_update", "audit_events_delete"))` with a comment matching file style (migration version V91, HEL-471, note on the 3-policy split and that the append-only guarantee is trigger-carried not RLS-carried)
- [x] 1.4 Add `connector_credentials -> None` with a comment matching file style (migration version V92, HEL-536, direct owner, V35 pattern) and remove the now-stale "pre-existing gap" comment on the `connectors` entry
- [x] 1.5 Update the per-table loop so that when the map value is `Some(names)`, it asserts `pg_policies.policyname` for the table equals exactly `names` (not just `count > 0`); when `None`, keep the existing `count > 0` assertion verbatim — verify by running `sbt "testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec"` and confirming all existing per-table cases still pass unchanged
- [x] 1.6 Add the non-vacuousness probe test (design.md D3): a second EmbeddedPostgres+Flyway instance, `DROP POLICY audit_events_update ON audit_events;`, assert the (refactored, shared) per-table check now fails for `audit_events` — verify the probe test itself passes, proving the guard is genuinely red-capable
- [x] 1.7 Update the class-level doc comment (coverage list, D3 "explicit allowlist" note) to describe the new `Option[Set[String]]` shape and the probe test's existence

### Tests

- [x] 2.1 Run `sbt test` for the full backend suite and confirm no regressions; run `sbt "testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec"` in isolation and confirm the augmented spec is green with exactly `audit_events` and `connector_credentials` now covered
- [x] 2.2 Manually verify allowlist scoping (distinct from D3's non-vacuousness probe): temporarily comment out the `connector_credentials` map entry (a table the D3 probe does not touch), run the spec, confirm only `connector_credentials`'s own three assertions are skipped and every other table's checks (including `audit_events`'s and the D3 probe) still pass unaffected, then restore it — record this as evidence, do not leave the entry removed. (Do not use `audit_events` for this check: the D3 probe test looks up `audit_events`'s expected policy-name set in the same map, so removing that entry breaks the probe rather than demonstrating scoping — that failure is a taskrunner artifact of this manual check, not new evidence.)

### Follow-up

- [x] 3.1 File a spinoff Linear ticket for mechanically enforcing the migration↔`rlsTables` same-PR contract (design.md D4); record its id in the PR body (filed as HEL-923)
