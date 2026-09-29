## Standing Constraints

- [C1] Budget exhaustion is a MANDATORY escalation, never a self-approval, including the post-final-REFUTE re-evaluation loop.
- [C2] After a final-gate REFUTE is fixed with code, re-run the evaluator. ANY commit after a final-gate CONFIRM (including script-only/allowlist/merge-from-main commits) needs a fresh final-gate verdict on the new head.
- [C3] Any loop or parallel workload runs at <=3-4 workers under nice -n 19 (6c/12t desktop).
- [C4] Never label anything an owner ruling unless it came from the owner via the driver, labelled as such.
- [C5] timeout: 600000 on every Bash call that can run hooks, sbt, tests, or CI.

## 1. Backend: shared capability logic

- [x] 1.1 Add `OutputFilterCapability.scala` (`services/pipelines/`): `Operator` ADT
      (`Contains`/`Eq`/`In`/`Gte`/`Lte`), `staticOperatorsFor(DataFieldType)` (design.md D2/D5),
      `MaxDropdownCardinality = 50` constant. Verify: compiles, unit test covers every
      `DataFieldType` case's static operator set.
- [x] 1.2 Add `NodeSnapshotRepository.distinctValueCountCapped(pipelineId, nodeStepId,
      explicitRootId, column, capPlusOne)` and `.topDistinctValues(..., column, cap)` — reuse the
      existing `nodeFilterFragment` (never duplicate the WHERE fragment). Verify: repository-level
      test against a seeded snapshot with known distinct-value counts and frequencies.
- [x] 1.3 Add `OutputFilterCapability.buildContract(output, nodeSnapshotRepo)` (full-schema, used
      by `filter-capabilities`) and `.eqInEligibleColumn(output, nodeSnapshotRepo, column)`
      (single-column, used on-demand by the rows filter and distinct-values). Verify: unit test —
      a Structured column with a seeded high distinct count is excluded from eq/in; a low-count
      one is included; a Content-category/absent column never appears.

## 2. Backend: rows endpoint `ops[]` extension

- [x] 2.1 Extend `OutputRowsQuery.FilterParam`/wire parsing (`OutputRoutes.parseFilterParam`) to
      accept an optional `ops: [{column, op, value?, values?}]` alongside the unchanged
      `quick`/`columns`. Verify: parser unit test round-trips `gte`/`lte`/`eq`/`in` shapes and
      rejects malformed JSON as `400` (unchanged behavior for the pre-existing shape).
- [x] 2.2 Make `OutputRowsQuery.resolveFilter` `Future`-returning; validate each `ops` entry in
      order: column present+Structured -> type-eligible for the op -> (`eq`/`in` only)
      `eqInEligibleColumn` check (design.md D3). Verify: unit test for each rejection path,
      naming the offending column+op.
- [x] 2.3 Extend `NodeSnapshotRepository.FilterSpec`/`filterWhereFragment` with bound `ops`
      predicates: `eq`/`gte`/`lte` cast BOTH sides via `safe_numeric`/`safe_timestamptz` for
      numeric/timestamp columns (plain text compare for string/boolean `eq`); `in` as a bound
      `IN (...)` list capped at 100, casting EACH element individually with the SAME per-column
      cast as `eq` (`safe_numeric(data ->> $col) IN (safe_numeric($v1), safe_numeric($v2), ...)` /
      `safe_timestamptz(...)` for numeric/timestamp columns; plain bound text `IN (...)` for
      string/boolean — design.md D3's revision). Multiple ops on the same column AND together.
      Verify: repository-level test proves a `gte`+`lte` pair on the same column expresses a range,
      and a separate test proves `in` matches a numeric/timestamp column via the cast form (not
      text comparison — e.g. `"1000"` matches a stored `1000.0`-equivalent value).
- [x] 2.4 Wire `OutputService.rows`/`OutputRoutes` through the now-`Future` `resolveFilter`.
      Verify: `sbt compile` + existing `/rows` tests still pass unmodified.

## 3. Backend: new routes

- [x] 3.1 Add `OutputService.filterCapabilities(id, user)` calling `OutputFilterCapability.buildContract`,
      and `GET /api/outputs/:id/filter-capabilities` in `OutputRoutes.scala` (same ACL block as
      `rows`/`panels`/`assertion-status`). Verify: route test against a seeded Output.
- [x] 3.2 Add `OutputService.distinctValues(id, user, column)` calling `eqInEligibleColumn` then
      `topDistinctValues`, and `GET /api/outputs/:id/distinct-values?column=` in
      `OutputRoutes.scala`. Verify: route test — eligible column returns capped/ordered values,
      ineligible column returns 400.

## 4. Backend: migration (only if needed)

- [x] 4.1 Confirm no new SQL function/index is required (design.md D7 — reuses V111's
      `safe_numeric`/`safe_timestamptz`, no functional index). If a gap is found during
      implementation, add `V112__<name>.sql` (next free number, confirmed at Planning) and update
      design.md's D7 rationale to match. Verify: `ls backend/src/main/resources/db/migration |
      sort -V | tail -3` still shows a clean, gap-free sequence after any addition.

## 5. Schemas & spec sync

- [x] 5.1 Add `schemas/outputs/output-filter-capabilities-response.schema.json` and
      `schemas/outputs/output-distinct-values-response.schema.json`. Verify:
      `npm run check:schema-drift` (or repo's schema-drift check) passes.
- [x] 5.2 Update `schemas/outputs/output-rows-response.schema.json`'s description to mention the
      new `ops` filter shape (response body shape itself is unchanged). Verify: schema still
      validates the unchanged response body against existing fixtures.

## 6. Docs

- [x] 6.1 Update `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §3 to
      record the 2026-09-29 owner re-scope (server-refetch only; Recompute dropped for v0.8;
      dashboard variables deferred to v0.9/HEL-1192) — restate, do not delete the prior text's
      historical record. Verify: the section reads consistently with HEL-915's own re-scope
      comment.

## 7. Tests

- [x] 7.1 Red-first: on current `main` (pre-fix), write a test asserting a `gte`/`lte` range
      filter and an `in` filter on an Output larger than one page narrow the WHOLE Output — prove
      it FAILS today (no such operators exist), then implement and confirm it passes. Verify:
      test output captured showing red-then-green.
- [x] 7.2 Capability-contract <-> rows-endpoint drift test (both directions): for a seeded Output,
      assert every operator the contract lists for a column is ACCEPTED by `/rows`, and every
      operator NOT listed for that column is REJECTED (400) by `/rows`. Verify: this test would
      fail under mutation — temporarily hardcode a divergent `MaxDropdownCardinality`-equivalent
      literal at ONLY the `/filter-capabilities` call site (leaving the rows-endpoint's shared call
      untouched) to simulate the two call sites disagreeing, and confirm the test catches the
      resulting mismatch; then revert.
- [x] 7.3 Distinct-values test: capped, frequency-ordered, ownership-checked (a non-owner/no-grant
      caller gets the same ACL outcome as `/rows`), refused for a column without eq/in. Verify:
      seeded fixture with known frequencies asserts exact ordering.
- [x] 7.4 Hostile-input test: a column name and a filter value containing SQL metacharacters
      (`'; DROP TABLE node_snapshots; --`) against `ops[].column`, `distinct-values`'s `column`
      param, and an `ops[].value`/`values` entry — assert 400/no-match, no SQL error, table intact
      (`SELECT count(*) FROM node_snapshots` unchanged). Verify: test fails against a
      hand-introduced raw-interpolation mutation (proves the guard actually bites).
- [x] 7.5 Malformed-value-does-not-500 test: an `eq`/`gte`/`lte` value that fails
      `safe_numeric`/`safe_timestamptz` parsing on a real column returns `200` with zero matches
      for that clause, never `500`. Also cover `in`: a list with one malformed element alongside
      otherwise-valid elements (design.md D3 revision) — the malformed element matches no row
      (never a 500), and the other elements' matches are unaffected.
- [x] 7.6 Run `npm run check:node-root-encoding`, `:selftest`, `:ts`, `:ts:selftest` locally if
      `NodeSnapshotRepository.scala` was touched (it will be) — before every gate, not just once.
      Verify: all four exit 0.
