## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed the untracked change dir at HEAD 76816d406e15f10ee1c53431fea801cb18637062. I did not relitigate the owner
rulings Q1-Q4.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/migrate-v94-dead-output-keys/HEL-1387`.
- **V117 is still free.** After `git fetch origin main`, `git ls-tree origin/main .../db/migration/` tops out at
  `V116__node_payload_history.sql`.
- **Round-1 CR1 (vacuous AC7) is addressed.** D8 and task 2.4 add two checks: `keys ⊆ KnownKeys(kind)` and
  `validate(kind, cfg, JsObject.empty)` is Right. Both must be shown failing on the pre-V117 configs.
  - I read `OutputConfigValidation.scala` to confirm the strict variant cannot fail for an unrelated reason.
  - With `stored = {}`, `validate` judges the keyset, then the `chartType`/`aggregation` shapes only if those keys
    are present.
  - V94 never writes `chartType` or `aggregation` into Output config (`V94__outputs_model.sql` L696-757). The only
    other key it writes is `fieldMapping`, which is in `Shared`.
  - So the dropped "fall back if unrelated" clause is harmless.
- **Round-1 CR2 (audit-table posture) is addressed in design.md D4 and task 1.2/2.5.** These now mirror
  `V105__oauth_states.sql` (FORCE, `_deny_all USING (false)`, explicit GRANT to `helio_privileged`). The
  `RlsPolicyGuardSpec` entry is stated exactly and matches the spec's `Map[String, Option[Set[String]]]` encoding
  (L78, L146). The test expectations are precise: 0 rows as `helio`, N as `helio_privileged` and as the superuser.
  Two artifacts still contradict this; see CR1 below.
- **Round-1 CR3 (re-run bracket) is addressed.**
  - D5 step 3 adds `NO FORCE` on the audit table after its CREATE.
  - Task 1.2 follows the D5 order.
  - D8 and task 2.3 add a re-run with a re-inserted dead key that expects success and exactly one new audit row.
  - The re-runnable policy statement is `DROP POLICY IF EXISTS` + `CREATE POLICY`.
- **Round-1 CR4 (audit contract) is mostly addressed.** D2 now specifies:
  - one row per removed top-level key;
  - `config -> key` (so JSON null is stored, not SQL NULL);
  - a nested object stored whole in a single row;
  - `live_key` NULL except for `renamed`;
  - a single column name, `action`;
  - an ordered precedence.

  The precedence wording has one defect; see CR2 below.
- **Round-1 CR5 is addressed.**
  - The spec delta's requirement is now scoped to "Migration V117 SHALL remove…".
  - Task 3.1 files both follow-ups: RestorePriorStored normalisation, and metric `format` object vs string.
- **Round-1 CR6 is addressed.**
  - D8 and task 2.2 bind one chart and one metric panel to a real `metrics` row. They require the chart's `format`
    to be dropped as `kind-inapplicable` and the metric's to be byte-identical.
  - D8 sets the `column_order`/`chart_options` legacy columns on real panels, so V94 itself produces the Q3 keys.
  - I confirmed in V94 L707 that `jsonb_build_object('format', metric_row.format)` is outside `jsonb_strip_nulls`. A
    `metric_id` panel whose metric has a NULL format therefore gets `"format": null`. On a chart this is still rule 1
    `kind-inapplicable`, which is consistent.
- **Round-1 non-blocking notes are folded in.** D2 decides not to touch `updated_at`, with a test assertion. D2 uses
  `config -> key`. The metric-format follow-up is in Non-Goals and task 3.1.
- **The design is otherwise sound.**
  - The D1 mapping matches `KnownKeys` (chart: chartOptions/annotation; metric: label/unit/format; table: columnOrder;
    collection: layout/format; timeline: sort; markdown: content).
  - `Renames` and `DeadStyling` in the validator agree with D1.
  - The D5 bracket order is correct, including the FORCE flags on re-run.
  - Flyway's transactional PG migration rolls back the whole file if the D7 guard fires.
  - The `FlywayNonSuperuserMigrationSpec` FORCE-RLS table check (L352-358) will still pass, because the audit table
    ends FORCE'd.

### Verdict: REFUTE

All three items are small text fixes. They are blocking because each leaves an artifact contradicting another, or
the durable spec, on something the implementer or a later reader will act on.

### Change Requests

1. **Two artifacts still describe the audit table as having "no policies", which contradicts D4.**
   - `proposal.md` L31 says: "which has FORCE RLS and no policies, so it is admin-only".
   - `design.md` L164 (Planner Notes) says: "D4 admin-only via FORCE RLS with no policies".
   - D4 and task 1.2 now require a `_deny_all` policy, and `RlsPolicyGuardSpec` will assert that exact policy set.
   - Fix: reword both lines to "FORCE RLS, a deny-all policy, and an explicit SELECT grant to `helio_privileged`
     (mirrors V105)".
   - Also reword `proposal.md` L26 ("stored Output config carries no V94/HEL-877 dead keys"), which still states the
     standing invariant that round-1 CR5 had rescoped in the spec. It should say "migration V117 repairs…".

2. **D2 rule 1, read literally, makes rule 2 unreachable.**
   - Rule 1 is "any key on a kind it isn't renamed or accepted for".
   - `columnWidths`, `tableDensity`, `legend`, `tooltip`, `seriesColors` and `axisLabels` are renamed or accepted on
     **no** kind. So every occurrence of them matches rule 1 (`kind-inapplicable`), and rule 2 (`no-live-equivalent`)
     can never fire.
   - The sentence after rule 1 ("That covers a rename source on the wrong kind … and format/columnOrder/chartOptions …")
     suggests the narrower intended scope. An implementer can still read it either way, and the test asserts exact
     `action` values in a permanent audit table.
   - Fix: scope rule 1 explicitly. For example: "`kind-inapplicable` — a rename source (`metricLabel`, `metricUnit`,
     `chartAnnotation`, `collectionOptions`, `timelineOptions`) on a kind other than its D1 rename kind, or
     `format`/`columnOrder`/`chartOptions` on a kind whose `KnownKeys` lacks it."
   - Rule 2 then applies to the six no-equivalent keys on every kind, including chart.

3. **The spec delta's rename SHALL contradicts D1/D3's shape guard and null handling.**
   - `specs/outputs-model/spec.md` says: "A dead key with a live equivalent SHALL be renamed to that live key when the
     kind accepts it and the live key is absent or JSON null."
   - D1 and D3 drop the key instead (`invalid-value` / `null-value`) when:
     - the source value fails the shape guard, e.g. a numeric `metricLabel`, or `collectionOptions.layout: "tile"`;
     - the source value is JSON null;
     - the nested `layout`/`sort` is absent.
   - The archived spec would then mis-state the shipped behaviour, and a final-gate check against the spec would flag
     correct code.
   - Fix: add the condition to the SHALL, e.g. "…and the dead value is non-null and passes the D1 shape guard (a
     string for label/unit/annotation; `grid`/`list` for layout; `asc`/`desc` for sort); otherwise it SHALL be
     dropped."
   - Add one scenario for it, e.g. a numeric `metricLabel` with no `label` is dropped and audited as `invalid-value`.
   - Mirror the same condition in `proposal.md`'s first bullet.

### Non-blocking notes

- **D2 rule 3 is listed before rule 5.** So a JSON-null `metricLabel` alongside a non-null `label` is recorded as
  `null-value`, not `shadowed-by-live`. That is deterministic and fine. Just make sure the test's expected rows follow
  this order.
- **Don't re-check FORCE on `outputs`.** `FlywayNonSuperuserMigrationSpec`'s FORCE-RLS loop (L352) does not need the
  audit table added. Adding it is harmless, but do not mistake that loop for the D8 posture assertions.
- **Unknown non-D1 keys are left in place.** Post-V94 Outputs created via the API before HEL-1313 may carry unknown
  keys that are not in D1 (typos and the like). V117 rightly leaves them, and the D7 guard covers only the D1 set. If
  the PR's dev-DB count (AC8) finds any, report them separately rather than widening scope.

### Gate defects

None. No report in this change dir makes an mtime- or ordering-based evidence claim.
