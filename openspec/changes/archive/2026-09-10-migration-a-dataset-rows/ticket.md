# HEL-1074: Migration A: rename `static` rows to `dataset` and add the declared-schema column

## Description

One Flyway migration at the next free V number (`main` is at `V105__oauth_states.sql` as of 2026-09-10 — do not hardcode; re-verify against `origin/main` immediately before committing):

* `UPDATE data_sources SET kind = 'dataset' WHERE kind = 'static'`
* drop/re-add the `data_sources` kind CHECK constraint with `dataset` replacing `static`
* add `dataset_schema jsonb` (nullable), backfilled for migrated rows from their existing inferred schema

**AC (original):** verified against a real `pg_dump` fixture containing `static` sources, not a hand-built one. RLS policies must be exercised under a non-superuser role: Flyway runs as the non-BYPASSRLS `helio` role in production while every local/CI/prod-dump check runs as superuser and masks failures.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Corrected during Planning: the column is `source_type`, not `kind`

The ticket text (and the v0.8 spec) refer to a `data_sources` **`kind`** column and a "`kind` CHECK
constraint." Verified against the live schema (`V4__data_sources_and_types.sql` through
`V49__add_image_source_type.sql`, no later migration touches it): the actual column is
**`source_type`**, and the actual constraint name is **`data_sources_source_type_check`**, current
values `('rest_api', 'csv', 'static', 'sql', 'text', 'pdf', 'image')`. There is no column literally
named `kind` on `data_sources` (contrast `connectors.kind` from V93, a different table). Everywhere
below and in the spec deltas, "kind"/"`kind = 'dataset'`" means the `source_type` column — write the
actual migration SQL against `source_type`/`data_sources_source_type_check`, not a column named `kind`.

## Scope widened by owner ruling (recorded as a Linear comment on HEL-1074, 2026-09-11)

Orchestrator raised, during Setup's premise validation, that as originally filed this ticket omitted work the v0.8 spec's "Migration A" section and HEL-1075's design.md (`openspec/changes/archive/2026-09-10-decide-dataset-row-storage/design.md`) both bundle into "Migration A" — and that no sibling ticket in the epic (HEL-1073/1077/1078/1080) owns it either. The owner ruled **Option 1: widen this ticket to the full bundle**. Full scope for this ticket is now:

1. New `dataset_rows(id, data_source_id, seq, data jsonb, created_at, updated_at)` table.
2. Forced RLS policy on `dataset_rows`, scoped through `data_source_id → data_sources.owner_id`, mirroring the existing `data_sources_owner` policy on `data_sources`. **Must be exercised under a non-superuser, non-BYPASSRLS role** — including the backfill INSERTs and the `kind` UPDATE under forced RLS (the standing v0.7.x release trap: Flyway runs as the non-BYPASSRLS `helio` role in prod; every local/CI/prod-dump check runs as superuser and masks RLS failures).
3. Backfill `dataset_rows` from each source's current `data_sources.config` blob (for both already-`static` and any already-`dataset` rows).
4. Swap every legacy `readRawConfig`/`parseStaticPayload` READ call site onto `dataset_rows`. Re-enumerate from the tree at implementation time, don't trust any prior list blindly. As of Setup's own investigation (2026-09-11) these are: `InProcessPipelineEngine.scala:509` (via `PipelineRowJson.scala:140`), `SparkJobSubmitter.scala:169,171`, `DataSourceService.scala:930,933` (`previewStatic`). **The reader swap must be behavior-preserving** — same rows/order/types out of preview and both engines, proven via an explicit before/after comparison on the real fixture (not merely "tests still pass").
5. **Resolved during Planning (design.md Decision 7):** `DataSourceService.scala:146`/`:723` (both call
   `updateStaticPayload`, whole-blob replace) are retargeted to write `dataset_rows` directly, atomically,
   in this same change — not left on the blob. See design.md Decision 7 for the full rationale.
6. `UPDATE data_sources SET kind = 'dataset' WHERE kind = 'static'` + drop/re-add the `kind` CHECK constraint (dataset replacing static).
7. New nullable `dataset_schema jsonb` column, backfilled for migrated rows from their existing inferred schema — **verify where a static source's inferred schema actually lives today** before writing the backfill SQL (do not assume a column name/shape).
8. Decide explicitly what happens to `data_sources.config` payloads for `dataset`-kind sources after backfill (keep the blob at rest vs. clear it) — HEL-1075's design.md says config "becomes unused after the migration" and writes should stop for `dataset`-kind sources going forward, but does not explicitly say whether to clear existing blob contents. Follow HEL-1075's design; if genuinely silent on the keep-vs-clear question, escalate rather than guessing.
9. Correct the stale `StaticSource`/dataset scaladoc (tracked as HEL-1118, corrected once already for the spec but not yet for the code) as part of this diff, since this migration is what actually obsoletes the old premise in the code itself, not just the design doc.

## Acceptance Criteria

- [ ] Migration lands at the next free V number on `origin/main` at commit time (re-verified, not hardcoded from this ticket's authoring date).
- [ ] `dataset_rows` table exists with forced RLS through `data_source_id → data_sources.owner_id`.
- [ ] RLS is proven under a non-superuser, non-BYPASSRLS role — for the backfill INSERTs, the `kind` UPDATE, and ordinary per-owner row access — not just superuser/CI/pg_dump checks.
- [ ] Real `pg_dump`-derived fixture (containing genuine `static` sources) exercises the migration; a hand-built fixture is not sufficient.
- [ ] All identified legacy `readRawConfig`/`parseStaticPayload` read call sites are swapped onto `dataset_rows`, proven behavior-preserving via before/after comparison on the real fixture.
- [ ] The `updateStaticPayload` write-path question (item 5 above) is explicitly decided and documented, not left implicit.
- [ ] `data_sources.config` keep-vs-clear decision (item 8) is explicit and documented.
- [ ] `kind` CHECK constraint accepts `dataset`, no longer accepts `static` for new rows (existing `"static"` wire alias handling is HEL-1073's scope, not this ticket's — do not duplicate).
- [ ] `dataset_schema` backfilled correctly from the real, verified location of each migrated source's inferred schema.
- [ ] `StaticSource`/dataset scaladoc corrected to match the post-migration reality.
