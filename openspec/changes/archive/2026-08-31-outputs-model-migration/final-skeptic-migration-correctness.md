# Skeptic Report — final gate, dimension: migration-correctness (HEL-904, round 1)

HEAD verified: `dc95ccc4`. Worktree unmodified on exit (`git status` clean apart from
peer skeptics' reports); `V94__outputs_model.sql` md5 `a50b7bd5…` identical before and
after my mutation runs.

## Method

I did not rely on any prior report's conclusion. Every claim below is derived from one of:
the migration file read in full (all 1060 lines), a fresh `sbt testOnly` run I executed,
a mutation I applied and reverted myself, or **a real PostgreSQL 18 database** I built
from the committed fixture and ran `V94__outputs_model.sql` against end-to-end
(scratch DBs `hel904_skeptic` / `hel904_b`, schema from a `pg_dump -s` of the V93 dev DB,
data from `hel904-real-dump.sql`, dropped afterwards; the shared dev DB was only ever read).

---

## What I verified — evidence

### Fixture provenance and scrub — CLEAN

- `head -20` shows a genuine `pg_dump` 18.4 header (`SET statement_timeout`,
  `pg_catalog.set_config('search_path','',false)`, `SET row_security = off`).
- `grep -c "mattheworr018\|@gmail.com"` → **0**. Scrub complete.
- `grep -c "^INSERT INTO public.users"` → **594**. Unaltered.
- Loaded into a real Postgres with zero errors; `select count(*) from users` → **594**,
  `panels` 190, `pipelines` 73, `pipeline_steps` 78, `data_types` 289, `data_type_rows` 7169.
- `select version from flyway_schema_history … limit 1` on the shared dev DB → **93**, so
  nothing from this branch has been applied to the shared DB.

### Test suite — GREEN, and genuinely red under both mutations

- Fresh run: `Tests: succeeded 23, failed 0`.
- **Mutation 1** (section 10 predicate reverted to `type_id IS NULL`, lines 640/643):
  suite **ABORTED** — `ERROR: check constraint "panels_output_kind_requires_output_id"
  of relation "panels" is violated by some row`. Restored → 23/23 green.
- **Mutation 2** (line 455, section 9's loop selector narrowed to `p.type = 'text'` only —
  a call site I had not seen verified): **3 tests FAILED** (kind backfill, markdown Output,
  stranded-panel count). Restored → 23/23 green.

Both fixed defects are genuinely guarded. That part of the executor's/evaluator's account holds up.

### `position` is never reset — CONFIRMED

- The only `UPDATE pipeline_steps` in the entire file is the `parent_step_id` backfill
  (line 32); it sets no `position`. `grep -niE "set +position|position *="` returns only
  that statement's own `parent.position = child.position - 1` predicate.
- On the real migrated DB: **0** pre-existing steps changed position, **0** lost, 10 new
  (5 `compute` + 5 `aggregate`).
- Recursive `parent_step_id` walk depth equals pre-migration position rank for **every**
  step, all 78 — `walk_order_mismatches = 0`.
- Backfill robustness: 0 duplicate positions; 2 pipelines start at position 1 not 0
  (`6ba5075b…` 1–20, `e3c19110…` 1–4) but are contiguous, so
  `pipelines_with_multiple_roots = 0` — exactly one NULL-parent root per pipeline. Sound.

### `node_snapshots` row-for-row equality — CONFIRMED (real per-row assertion, and independently re-measured)

- The assertion at `V94OutputsMigrationSpec.scala:524-531` is a genuine per-row comparison
  (`actualRows shouldBe expectedRows` over full sorted `Vector[(rowIndex, parsedJson)]`),
  for every live pipeline — not a count.
- My own measurement on the real DB: `data_type_rows` with a live owning pipeline = **3284**;
  `node_snapshots` = **3284**; `missing_or_mismatched = 0`; `extra_snapshots = 0`;
  `wrong_node = 0` (every snapshot sits on that pipeline's *original* max-position step).

### `binary_refs` — CONFIRMED

The single real row is keyed by `(pipeline_id, node_step_id)`, not `data_source_id`,
matching the ticket's documented data-driven fallback. `binary_refs_unbackfilled = 0`;
`node_step_id` is NULL because that pipeline has zero steps (root), which is correct.
Legacy `data_type_id` dropped, `binary_refs_owner` policy replaced with the
`helio_can_access_pipeline` form.

### `computed_fields` → `compute` — data-correct

5 compute steps created; `computed_fields_migrated_pipeline_output = 5`,
`…_companion = 0` (correctly skipped + logged). Emitted config
`{"column","expression","type"}` matches `ComputeConfig(column, expression, type)`
(`ComputeStep.scala:14`) exactly. (But see Change Request 5 — this path has *no test*.)

### RLS smoke — genuine for `outputs`, weak for `node_snapshots`

The role is real: `CREATE ROLE helio_app_test_v94 NOSUPERUSER …` + `SET ROLE` via
`connectionInitSql`, against tables with `FORCE ROW LEVEL SECURITY`. Owner-read,
cross-tenant denial, a real red-proof (drop `outputs_select` → owner sees nothing;
restore → sees it), and a real grantee-read proof (deny before the
`resource_permissions` insert, allow after) — all four are genuine, on `outputs`.
See Change Request 6 for the `node_snapshots` half.

---

## Verdict: REFUTE

Three real defects, all reproduced on a real database against the real fixture, plus
three test-coverage gaps that are why none of them was caught. Findings 1–3 are all the
same class the last three cycles kept finding — an unhandled row shape silently reaching
an unrepresentable end state — so the pattern is demonstrably **not** exhausted.

## Change Requests

### 1. (Critical) Migration-created aggregate "tails" are placed on the **trunk**, not on a tail — 4 of 5 on real data

`V94__outputs_model.sql:539-543`:

```sql
SELECT COALESCE(MAX(position) + 1, 0) INTO next_position
FROM pipeline_steps
WHERE pipeline_id = pipeline_row.id
  AND ((parent_step_id IS NULL AND trunk_last_id IS NULL) OR parent_step_id = trunk_last_id);
```

The last trunk step, by definition, has no children — so `MAX(position)` is NULL and
`COALESCE(…, 0)` assigns **position 0**. The design spec is explicit
(`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`, `pipeline_steps`
row): "**Trunk** = the position-0 chain from the root; a **tail** = a child reached through
a position ≥ 1 edge and its descendants." `PipelineStepRepository.scala:365-377`
implements exactly that — `trunkOf` follows `childrenOf(...).headOption` (lowest
position), and `tailsOf` (`:383-395`) is `childrenOf(...).drop(1)`.

Evidence — the 10 migration-created steps on the real migrated DB:

```
hel904-tail-64daccee…  pipeline 3e535ac8…  parent NULL  position 0  aggregate
hel904-tail-93f894fc…  pipeline 3e535ac8…  parent NULL  position 1  aggregate
hel904-tail-e84a2024…  pipeline 555f4bae…  parent 41a4e665…  position 0  aggregate
hel904-tail-143500a9…  pipeline 81da0ebe…  parent 14df5f95…  position 0  aggregate
hel904-tail-c008a35a…  pipeline d0d104d5…  parent 70b95e31…  position 0  aggregate
```

and a SQL simulation of `trunkOf`'s exact rule over the migrated tree returns those four
`hel904-tail-*` steps **as trunk members** (trunk_depth 0 / 4 / 2 / 2); only
`93f894fc` (position 1) is correctly excluded.

Impact: a per-panel private aggregation becomes a **global transform on the pipeline's
main chain**. On `3e535ac8…` (a zero-step pipeline) the aggregate step becomes the
pipeline's *entire* trunk, so on its next run every consumer of that pipeline sees
aggregated rows instead of source rows. This is precisely what leaf tails exist to
prevent, and it is silent.

Fix: assign `GREATEST(COALESCE(MAX(position) + 1, 0), 1)` for the aggregate tails in
section 9 (only there — section 12's `compute` steps at position 0 are *correct*, since
the ticket specifies they extend the trunk). Note the ordering interaction this creates:
once section 9 stops taking position 0, a pipeline that has both an aggregation panel and
a computed field still gets a trunk-extending compute step. Today, on this dataset, no
pipeline has both — but with the current code, if one did, section 9 would take position 0
and section 12's compute step would land at position 1 and become a *tail*, which is the
mirror-image of the same bug. Both directions need to be pinned by the test in CR 4.

### 2. (Critical) An alert rule whose type has no owning pipeline survives with `target_output_id = NULL`, and the column is never `SET NOT NULL`

Ticket scope item 6 and the spec's `alert_rules` row both specify
`target_output_id TEXT NOT NULL REFERENCES outputs(id)`. The migration adds it nullable
(`:224`) and **never** applies `SET NOT NULL` — `\d alert_rules` on the migrated DB shows
`target_output_id | text | | |` (nullable).

Section 14's retarget CTE `JOIN pipelines p ON p.output_data_type_id = ar.target_data_type_id`
drops any rule whose target type has no owning pipeline. There are **77** such
`data_types` rows in the real fixture (`orphan_data_types_no_pipeline_skipped = 77` —
the migration counts them but does not consider the rules pointing at them), and the
pre-migration FK allows a rule to target one (`alert_rules_target_data_type_id_fkey`
references `data_types`, not `pipelines`).

Reproduced: I seeded one rule of that exact shape onto the real fixture and ran V94.
Result — `id=r-nopipeline, target_output_id = NULL`, and section 20 then drops
`target_data_type_id`, so the original target is **unrecoverable**.

This is worse than a dangling row. `AlertRuleRepository.scala:28-29`:

```scala
targetOutputId = OutputId(row.targetOutputId.getOrElse(
  throw new IllegalStateException(s"alert_rules row '${row.id}' has no target_output_id")
```

so any listing that maps such a row throws — a permanent hard failure on the alerts
surface, not a degraded one. `model.scala:883-886` asserts in a comment that "every
existing rule … [was] backfilled by the V94 migration's step (f)"; that claim is false
for this shape. `AlertEventRepository.scala:30-31` has the identical throw.

Note the dev DB has **0** `alert_rules` rows, so the fixture cannot exercise this and the
seeded rules in the spec both happen to resolve — which is exactly why a green suite is
not evidence here. **Prod is a different database and this migration is destined for it.**

Fix: after section 14, delete (or explicitly quarantine) rules and events left with
`target_output_id IS NULL`, log the count to `hel904_migration_counts` like every other
destructive step, then `ALTER TABLE alert_rules ALTER COLUMN target_output_id SET NOT NULL`
(and the same for `alert_events`) — the direct analogue of the
`panels_output_kind_requires_output_id` guard section 10 already added for the identical
panel-side defect.

### 3. (Major) Alert rules targeting a companion type are silently cascade-deleted by section 8, unlogged

`V94__outputs_model.sql:301-303` (`DELETE FROM data_types … source_id IS NOT NULL AND NOT
EXISTS (pipeline)`) deletes **139** companion types on the real fixture. The pre-migration
FK is `FOREIGN KEY (target_data_type_id) REFERENCES data_types(id) ON DELETE CASCADE`
(verified with `pg_get_constraintdef` against the live V93 dev schema), so every alert
rule and alert event pointing at a companion type is deleted as a side effect.

Reproduced: seeded `r-companion` onto a real companion type, ran V94, and it is **gone**
(`rules_before=3 → rules_after=2`), with **no** entry in `hel904_migration_counts`.

Deleting the rule may well be the right outcome (a companion type has no Output), but
doing it invisibly contradicts this file's own stated discipline — every other destructive
step (`stranded_output_panels_deleted`, `patch_set_journal_entries_removed`,
`orphan_data_types_no_pipeline_skipped`) records a count. Fix: count and log these
before section 8's `DELETE`, and state the behaviour in the migration comment.

### 4. (Major) The aggregate-tail test asserts nothing about tail-ness

`V94OutputsMigrationSpec.scala:372-417` is titled "create exactly one aggregate **tail** …"
but selects only `op, config` (`:387`) and checks `op`, `config` and `config.format`. It
never reads `position` or `parent_step_id`, and never calls `trunkOf`/`tailsOf`. That is
why CR 1 passed 30+ cycles and three evaluations undetected — the assertion does not test
the property in its own name. Fix: assert `parent_step_id` = the pipeline's original
trunk-last step **and** `position >= 1`, and assert the step appears in `tailsOf` and
*not* in `trunkOf` for its pipeline.

### 5. (Major) No test at all for `computed_fields` → `compute` steps

Ticket scope item 8 / spec migration step 3 / AC "≥ 1 computed field" in the fixture.
`grep -n "compute" V94OutputsMigrationSpec.scala` matches only a prose comment at `:45`.
The 5 compute steps this migration creates on real data are entirely unasserted — I had
to verify their config shape by hand against `ComputeStep.scala:14`. Add a test covering
count, `op`, config keys/values, parent, and (per CR 1) that they land at position 0 as
trunk extensions.

### 6. (Minor) The `node_snapshots` RLS assertion is half-vacuous

`V94OutputsMigrationSpec.scala:639-652`: `asOwner.size should be >= 0` is unconditionally
true, so only the denial half asserts anything. (I confirmed the denial is at least
non-vacuous — `alertPipelineId` really does have 1 `node_snapshots` row post-migration —
so this is a weakness, not a hole.) There is also no red-proof and no grantee-read for
`node_snapshots`, both of which exist for `outputs`. Since the two policies share the
identical `helio_can_access_pipeline(pipeline_id)` predicate the residual risk is low,
but the AC asks for both tables. Fix: `asOwner should not be empty`, plus a
policy-drop red-proof and a grantee-read on `node_snapshots`.

## Non-blocking notes

- The file header (`:1-17`) is stale — it still says the migration "is NOT yet complete …
  contains only the additive schema steps" and "Nothing in this file has been applied to
  any persisted … database yet". It now contains the full destructive DML through section 21.
- Section 10's comment cites "58 real panels" as the stranded count. The migration's own
  `hel904_migration_counts` on the real fixture reports **88** (28 with `type_id IS NULL`
  + 60 dangling). 60 matches the spec-header's "60-row stranded-panel shape"; "58" appears
  to be a stale first measurement. Cosmetic, but a reader will trust it.
- **3885** `data_type_rows` (of 7169) belong to types with no owning pipeline and are
  dropped by section 11's inner join. That is the intended behaviour, but unlike every
  other drop in this file it gets no `hel904_migration_counts` entry.
- Section 9's comment claims a `timeline` panel carrying `aggregation` "would fall through
  to the no-aggregation path". It would not — the branch is gated on
  `aggregation IS NOT NULL` regardless of kind, and `COALESCE(agg_blob->>'value',
  agg_blob->>'yField')` would yield a NULL alias. No such row exists today; the comment is
  simply wrong about the code beneath it.
- The migration depends on running inside one transaction (`ON COMMIT DROP` temp table at
  `:398`). Correct under Flyway; worth a one-line note so nobody runs it via `psql` without `-1`.
