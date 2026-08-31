# Skeptic Report — final gate, dimension: migration-correctness (HEL-904, round 2 of 2)

HEAD verified: `5977223a`. `V94__outputs_model.sql` md5 `785a6d33…` before and after my runs;
worktree clean apart from peer skeptics' reports. All scratch DBs dropped.

## Method

Independent, from ground truth only. I built **three** fresh PostgreSQL 18 databases
(`hel904_sk2/3/4`) from a `pg_dump -s` of the live V93 dev DB (`flyway_schema_history` max
version = 93, i.e. untouched by this branch), truncated the migration-seeded baseline exactly as
the spec's `beforeAll` does, loaded `hel904-real-dump.sql` verbatim (594 users / 73 pipelines /
78 steps / 190 panels / 289 data_types — matches round 1), and ran
`V94__outputs_model.sql` end-to-end under `psql -1 -v ON_ERROR_STOP=1`. I also ran the spec
(`sbt testOnly …V94OutputsMigrationSpec` → 26/26 green) and read `PipelineStepRepository`'s
`trunkOf`/`tailsOf`/`childrenOf` implementations directly.

## What I verified — evidence

### CR 1 (aggregate tails on the trunk) — **NOT FIXED**. See Change Request 1.

### CR 2 (alert rules surviving with `target_output_id IS NULL`) — FIXED, verified on real data

On `hel904_sk3` I seeded the two shapes round 1 used (`r-companion` on a real companion type,
`r-nopipeline` on a real pipeline-less type) onto the real fixture and ran V94:

```
alert_rules_cascade_deleted_companion_type | 1
alert_rules_deleted_unresolvable_target    | 1
alert_events_deleted_unresolvable_target   | 0
select id, target_output_id from alert_rules;  -> (0 rows)
pg_attribute.attnotnull for alert_rules.target_output_id -> t
```

Section 14a sits at `:921-952`, after section 14's retarget and before section 20's
`DROP COLUMN target_data_type_id` (`:1089`). The `SET NOT NULL` follows the `DELETE`s in the same
transaction, and no later section inserts alert rows — no row can survive to violate it. Correct.

### CR 3 (unlogged companion-type cascade delete) — FIXED, count is accurate

The count INSERT (`:301-306`) precedes section 8's `DELETE FROM data_types` (`:324`), so it is
measured pre-cascade. Measured 1 against my 1 seeded companion rule (0 on the bare fixture, which
genuinely has 0 `alert_rules`). Predicate matches the DELETE's predicate exactly.

### CR 5 (no `computed_fields` test) — FIXED, non-vacuous

`V94OutputsMigrationSpec.scala:494-533`. Guarded by `computedFieldsBeforeCapture should not be
empty` (my run: 5 real fields, matching `computed_fields_migrated_pipeline_output = 5`), and per
field asserts `op`, exact parent chaining, `position`, and full config equality against the
pre-migration JSON (`column`/`expression`/`type` ← `name`/`expression`/`dataType`). Real
assertions, not "didn't crash".

### CR 6 (`node_snapshots` RLS half-vacuous) — FIXED, genuinely non-vacuous

`:709-757`: `asOwner should not be empty`, a self-contained red-proof that drops
`node_snapshots_select`, asserts the owner sees nothing, then restores and re-asserts, plus a
grantee deny-before/allow-after `resource_permissions` test. The red-proof *is* the mutation test
(it drops the policy in-process and asserts red), and it passes — so the assertion is
demonstrably policy-dependent, not ambient.

### CR 4 (aggregate-tail test asserts nothing about tail-ness) — **INADEQUATELY FIXED**; it is
why CR 1 survived this cycle. See Change Request 1.

---

## Verdict: REFUTE

One finding: round 1's Critical CR 1 is **not fixed**. The `GREATEST(…, 1)` change moves the
positions but leaves the behaviour identical — **the same 4 of 5 aggregate tails are still trunk
members**, reproduced twice on independent fresh databases.

## Change Requests

### 1. (Critical, unfixed from round 1) `GREATEST(COALESCE(MAX(position)+1,0), 1)` does not remove the aggregate tails from the trunk — still 4 of 5 on real data

`trunkOf` does **not** select the position-0 child. `PipelineStepRepository.scala:365-377`:

```scala
childrenOf(steps, parent).headOption match { case Some(next) => loop(Some(next.id), …) … }
```

and `childrenOf` (`:376-377`) is `steps.filter(_.parentStepId == parent).sortBy(_.position)`. It
takes the **lowest-position child, whatever that position is**. Symmetrically `tailsOf`
(`:383-395`) is `childrenOf(...).drop(1)` — it drops the lowest-position child, again regardless
of its numeric position.

The trunk-last step has *no other children* (that is what made it trunk-last). So its sole new
child is the lowest-position child at any position — position 1 is just as much the trunk
continuation as position 0 was. `position >= 1` is therefore **neither necessary nor sufficient**
for tail-ness; the comment at `V94__outputs_model.sql:555-561` and the test comment at
`V94OutputsMigrationSpec.scala:408-413` ("position >= 1 is both necessary and sufficient for
exclusion from `trunkOf`'s walk") are both factually wrong about the code they cite.

Post-migration state on my fresh run of the real fixture (identical on `hel904_sk2` and
`hel904_sk4`):

```
hel904-tail-64daccee…  pipeline 3e535ac8…  parent NULL       position 1  aggregate
hel904-tail-93f894fc…  pipeline 3e535ac8…  parent NULL       position 2  aggregate
hel904-tail-e84a2024…  pipeline 555f4bae…  parent 41a4e665…  position 1  aggregate
hel904-tail-143500a9…  pipeline 81da0ebe…  parent 14df5f95…  position 1  aggregate
hel904-tail-c008a35a…  pipeline d0d104d5…  parent 70b95e31…  position 1  aggregate
```

and a SQL simulation of `trunkOf`'s exact rule (recursive walk taking `min(position)` among each
node's children, root = `min(position)` among `parent_step_id IS NULL`) over the migrated tree
returns:

```
aggregate_tails_still_on_trunk | 4      (64daccee depth 0, e84a2024 depth 4,
aggregate_tails_total          | 5       143500a9 depth 2, c008a35a depth 2)
```

— the identical 4 steps round 1 reported, at depths identical to round 1's. Only `93f894fc`
(now position 2, a genuine second sibling) is excluded. On `3e535ac8…`, a pipeline with **zero**
pre-existing steps, `hel904-tail-64daccee…` is still the pipeline's *entire* trunk: every
consumer of that pipeline will see aggregated rows instead of source rows. Impact and blast
radius are exactly as stated in round 1 CR 1 — nothing was mitigated.

Note this is not a mis-application of round 1's advice; round 1's suggested one-liner was itself
insufficient, and the executor adopted it without re-deriving from `trunkOf`'s actual rule.

**What a correct fix requires** (the migration must make the aggregate step a *second-or-later*
child, not merely a positive-position child — i.e. its parent must already have a lower-position
child):

- For a trunk-last step **with no children**, the aggregate tail must not be its only child.
  Either (a) re-parent so the aggregation hangs off a node that retains a lower-position trunk
  child, or (b) emit an explicit position-0 trunk continuation (e.g. a passthrough/no-op step) so
  the aggregate at position 1 is genuinely `drop(1)`, or (c) change `trunkOf`/`tailsOf` to key on
  `position == 0` so the invariant the migration is coded against is the one the code implements
  — but (c) is a repository behaviour change and needs its own decision, since it also alters the
  two real pipelines whose pre-existing steps start at position 1 (`6ba5075b…`, `e3c19110…`,
  noted in round 1), which would then have **no** trunk at all.
- The **zero-step pipeline** case (`3e535ac8…`) must be handled explicitly: there is no trunk to
  hang a tail off, so a per-panel aggregation there is unrepresentable in the current tree model
  without inventing a root. Decide and encode it (a source/passthrough root at position 0 is the
  obvious candidate), don't let it fall through.

**And the test must assert the actual property, not a proxy.** Replace/augment
`V94OutputsMigrationSpec.scala:405-417`'s `position should be >= 1` with an assertion that
evaluates `PipelineStepRepository.trunkOf` / `tailsOf` (or a faithful SQL simulation of
`headOption`-by-lowest-position) over the migrated steps of that pipeline, and asserts the
`hel904-tail-*` step is **absent from `trunkOf`** and **present in some `tailsOf` branch**. The
current assertion passes on a database where 4 of 5 tails are trunk members — the suite is green
right now (26/26, verified) with the defect fully live, which is precisely the round-1 failure
mode repeating.

## Non-blocking notes

- Fix the two comments cited above (`V94__outputs_model.sql:555-561`,
  `V94OutputsMigrationSpec.scala:408-413`) as part of CR 1 — they assert a false property of
  `trunkOf` and will mislead the next reader.
- Round 1's non-blocking notes about the stale file header (`:1-17`) and the "58 real panels"
  comment vs. the migration's own `stranded_output_panels_deleted = 88` (I re-measured 88) are
  still unaddressed. Cosmetic.
- Everything else in round 1's report that was actionable (CRs 2, 3, 5, 6) is genuinely fixed and
  verified above.
