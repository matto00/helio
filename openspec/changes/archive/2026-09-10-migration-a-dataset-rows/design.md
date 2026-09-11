## Context

`data_sources` has a `source_type` column (NOT `kind` — corrected from the ticket/spec wording during
Planning; the constraint is `data_sources_source_type_check`, currently `('rest_api', 'csv', 'static',
'sql', 'text', 'pdf', 'image')`, last touched by `V49__add_image_source_type.sql`). `config` is JSONB
(`V33__jsonb_columns.sql`). `StaticSource` rows store `{columns, rows}` in `data_sources.config`, read
via `DataSourceRepository.readRawConfig`/`parseStaticPayload`. Each source's inferred schema lives in
its own `data_sources.inferred_schema` JSONB column (HEL-904), written via `upsertInferredSchema` — but
that column holds **runtime-derived** types (`PipelineRowJson.staticColumnRuntimeType`, HEL-893), which
can disagree with the blob's own **declared** `columns[].type` (real fixture evidence: `MyManualSource`
declares `test3: float` but stores mixed `1.2`/`3`; `acl-smoke-static` declares `id: integer` — round
1's skeptic review confirmed declared and runtime types diverge in practice, not just in theory).

Read call sites for the blob:
- `InProcessPipelineEngine.scala:509` → `PipelineRowJson.scala:140` (`parseStaticPayload`, uses
  `columns` for names/order)
- `SparkJobSubmitter.scala:169,171` (uses `columns[].type`, **declared**, to build the Spark `StructType`)
- `DataSourceService.previewStatic` (`DataSourceService.scala:930,933`, uses `columns` for headers)

Write call sites: `DataSourceService.createStatic` (`:146`) and `refreshStatic` (`:723`), both via
`updateStaticPayload`.

**Persistence-boundary mapping (round-1 finding, not in the original ticket/spec at all):**
`DataSourceRepository.rowToDomain` (`:40`) dispatches on `row.sourceType` against
`DataSourceKind.Static = "static"` and throws `IllegalStateException` on any unrecognized value;
`domainToRow` (`:88`) always writes `DataSourceKind.Static` (`"static"`) for a `StaticSource`. Both
must be updated in this ticket or the migration bricks the app (see Decision 6).

**RLS-under-migration precedent:** `data_sources` already carries `FORCE ROW LEVEL SECURITY` (V35) and
its `data_sources_owner` policy calls `current_setting('app.current_user_id')` **without**
`missing_ok`, which raises `SQLSTATE 42704` when unset — exactly the failure that broke three prior
production deploys (HEL-943, see `V94`'s and `V96`'s own migration headers). The established, proven
fix used by both `V94` (section 0/22) and `V96` is to bracket the touching statements with
`ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY` / `... FORCE ROW LEVEL SECURITY` — **not** the
per-row `app.current_user_id` idea a round-1 draft of this design proposed, which is not a workable
mechanism for a set-based backfill. `V35`'s policies (cited in round 1) are the right *shape* reference
for the new `dataset_rows` policy, but not the right reference for *how a migration safely writes to an
already-forced table* — that's `V94`/`V96`. The non-superuser proof harness for this is
`FlywayNonSuperuserMigrationSpec` (role `helio_migration_test`), which already runs the entire chain
against `hel904-real-dump.sql` — the real fixture this ticket's AC requires, already in-repo at
`backend/src/test/resources/db/fixtures/hel904-real-dump.sql`. It contains genuine `static` sources,
including `MyManualSource` with **`owner_id NULL`** (line 1187) — see Decision 8.

## Goals / Non-Goals

**Goals:**
- One Flyway migration creating `dataset_rows` with forced RLS (correctly bracketed per Decision 1),
  backfilling it from `data_sources.config`, rewriting `source_type` static→dataset, adding+backfilling
  `dataset_schema` from the **declared** column list (Decision 3).
- Swap the three legacy blob READ call sites onto `dataset_rows`, proven behavior-preserving against
  golden values captured before the swap (Decision 9).
- Update `DataSourceRepository.rowToDomain`/`domainToRow` so migrated rows don't crash the app
  (Decision 6).
- Retarget `create`/`refresh` write paths onto `dataset_rows`, atomically (Decision 7).
- Clear `data_sources.config` after backfill is verified complete (Decision 4).
- Correct the stale `StaticSource` scaladoc.
- Prove RLS holds under `FlywayNonSuperuserMigrationSpec` against the real fixture, including the
  `owner_id IS NULL` row (Decision 8).

**Non-Goals:**
- The row write API (`POST`/`PUT`/`PATCH`/`DELETE /api/data-sources/:id/rows`) — HEL-1077/1078. Existing
  `create`/`refresh` endpoints are retargeted at `dataset_rows` as part of this migration, but no new
  per-row API surface is added here.
- `DatasetSource` domain-model ADT member, `ConnectorRegistry` registration, `"static"` wire alias —
  HEL-1073. The Scala type stays `StaticSource`; `DataSourceKind.Static` stays the wire value
  `"static"`; only the **stored** `source_type` column value and internal row storage change (Decision
  6).
- Dataset management UI — HEL-1080.

## Decisions

### Decision 1: `dataset_rows` table + RLS, correctly bracketed for migration-time writes

```sql
-- Section A: create the table, ENABLE but do not yet FORCE (so this migration's own
-- backfill inserts, run as the table owner, succeed without needing app.current_user_id set —
-- mirrors V94's "create new tables without FORCE, apply FORCE at the very end" pattern).
CREATE TABLE dataset_rows (
    id             TEXT        NOT NULL PRIMARY KEY,
    data_source_id TEXT        NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    seq            BIGINT      NOT NULL,
    data           JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (data_source_id, seq)
);
CREATE INDEX idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq);

ALTER TABLE dataset_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY dataset_rows_owner ON dataset_rows
  USING (
    EXISTS (
      SELECT 1 FROM data_sources ds
      WHERE ds.id = dataset_rows.data_source_id
        AND ds.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

-- Section B: bracket every statement that reads/writes data_sources for the backfill,
-- the dataset_schema backfill, the source_type rewrite, and the config clear — the
-- established V94/V96 pattern, NOT the per-row-context idea round 1 proposed.
ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY;

-- ... backfill dataset_rows from config (Decision 2/9's ordering),
-- ... backfill dataset_schema from config->'columns' (Decision 3),
-- ... drop/re-add the source_type CHECK constraint and run the UPDATE (Decision 5),
-- ... clear config for migrated rows once backfill is parity-verified (Decision 4)
-- all happen here, inside the NO FORCE window.

ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;

-- Section C: only now, once dataset_rows is fully backfilled, apply FORCE so ordinary
-- runtime app-pool access is protected identically to every other owner-scoped table.
ALTER TABLE dataset_rows FORCE ROW LEVEL SECURITY;
```

`id`/`data_source_id` are `TEXT`, matching `data_sources.id`'s actual `TEXT` PK type (`V4`) — **the
spec delta's "UUID PK" was wrong and is corrected in the same pass as this design** (see the spec delta
diff). `UNIQUE (data_source_id, seq)` is added now (round-1 non-blocking note) since HEL-1077's append
concurrency will need it and it costs nothing here.

### Decision 2: Backfill ordering inside the NO FORCE window

Order matters because of Decision 5 (constraint-before-UPDATE) and Decision 4 (clear-after-parity):
1. `INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) SELECT
   gen_random_uuid()::text, ds.id, elem.ord, elem.value, ds.created_at, ds.updated_at FROM data_sources
   ds, jsonb_array_elements(COALESCE(ds.config->'rows', '[]'::jsonb)) WITH ORDINALITY AS elem(value,
   ord) WHERE ds.source_type = 'static'` — `seq` from `WITH ORDINALITY` (matches `V96`'s own
   established idiom for preserving JSONB array order); the `COALESCE` handles a source whose `config`
   is `'{}'` (round-2 finding — see below) by inserting zero rows for it, not erroring.
2. **In-migration content-level parity guard** (`DO $$ ... RAISE EXCEPTION ... $$`, Decision 4):
   for every migrated source, the ordered array reconstructed from its `dataset_rows` (by `seq`) must
   equal `COALESCE(config->'rows', '[]'::jsonb)` **exactly** (`jsonb_agg(data ORDER BY seq) IS NOT
   DISTINCT FROM COALESCE(config->'rows', '[]'::jsonb)`) — not merely a row-count comparison (round 1's
   original guard only compared counts, which round 2 found insufficient once byte-for-byte fidelity
   matters; the positional-array shape from Decision 3 makes this an exact-equality check, not an
   approximate reconstruction check). Aborts the whole migration transaction on any mismatch.
3. Backfill `dataset_schema` from `COALESCE(config->'columns', '[]'::jsonb)` (Decision 3 — the
   `COALESCE` again covers the `config = '{}'` case, satisfying "non-null `dataset_schema`" for every
   migrated row, including ones with no declared columns at all).
4. Drop `data_sources_source_type_check`; `UPDATE data_sources SET source_type = 'dataset' WHERE
   source_type = 'static'`; re-add the constraint with `dataset` in place of `static` (Decision 5 —
   constraint must be dropped **before** the UPDATE, not after; round 1 had this backwards).
5. Clear `config` to `'{}'::jsonb` for the migrated rows (Decision 4), now that both 2 and 3 are
   verified complete for those rows.

**Non-blocking, recorded per round 3:** a JSON `null` (or otherwise non-array) `config->'rows'` or
`config->'columns'` value is unreachable from any writer (`createStatic`/`refresh` always serialize a
typed `Vector`) and every legacy reader would itself throw on it — `jsonb_array_elements` correctly
**aborts the migration** on such a value rather than silently filtering it out; do not "fix" this by
adding a lossy filter.

**Round-2 finding: `config = '{}'` is a real, pre-existing state, not a hypothetical.**
`DataSourceService.update` (`:558`) → `DataSourceRepository.update` (`:175`) writes `config = "{}"` for
every `StaticSource` on a plain rename (`case _: StaticSource => "{}"`) — this already silently wipes a
static source's rows today, independent of this migration. The `COALESCE`s in steps 1 and 3 make such a
source migrate cleanly to zero rows and an empty `dataset_schema: []`, matching
`parseStaticPayload("{}")`'s existing empty-result behavior — this migration does not need to "fix" the
underlying rename bug, only migrate its already-lost state without erroring or producing `NULL`. This
migration incidentally *ends* that data-loss bug going forward (Decision 7's atomic writes no longer
route through the blanket `case _: StaticSource => "{}"` `config`-clobber on non-static-payload updates)
— worth noting in the PR description; a spinoff ticket to notify already-affected users, if any exist in
prod, is a product decision out of scope for this ticket and is not being filed unilaterally here.

### Decision 3: `dataset_schema` is backfilled from the blob's declared `columns`, not `inferred_schema`; `dataset_rows.data` is a positional array, not an object

Round 1 assumed `inferred_schema` (runtime-derived types) was an adequate backfill source. It is not:
Spark (`SparkJobSubmitter`) builds its `StructType` from the blob's **declared** `columns[].type`, and
a source with zero rows has no `inferred_schema` signal at all beyond the declared columns. Using
`inferred_schema` would silently change Spark's output types for any source where declared and runtime
types disagree (confirmed present in the real fixture) and would break the "behavior-preserving reader
swap" AC. **`dataset_schema` is backfilled from `COALESCE(config->'columns', '[]'::jsonb)`** (name +
declared type, in blob order; the `COALESCE` handles round-2's finding below) — this also makes it
genuinely the "user-declared, authoritative" schema the v0.8 spec's Decision 3 describes, since the
declared type is what the user actually specified, not what a value happened to look like at storage
time. This diverges from the ticket's literal wording ("backfilled... from their existing inferred
schema") — recorded here as the reason; not the "genuinely silent" case since Spark's own consumption
of `columns[].type` settles it in one direction.

**Round-2 finding (superseding round 2's original object-keyed choice): `dataset_rows.data` is a
positional array, not an object keyed by column name.** The object-keyed shape was reviewed and found
lossy: `createStatic`/`refreshStatic` validate only name, row count, and column types
(`DataSourceService.scala:96-122`) — nothing prevents duplicate column names, or rows longer/shorter
than `columns`. Both legacy readers are themselves positional (`DataSourceService.previewStatic`
emits rows verbatim; `SparkJobSubmitter.loadDataFrame` zips row values with schema fields by index),
so an object-keyed store would collapse duplicate-name columns to one key and make a
missing-vs-`null` cell ambiguous — a real, silent divergence from today's behavior that a
count-only parity check cannot detect before `config` is cleared. **Storing `data` as a JSON array
positionally aligned to `dataset_schema` (`config->'rows'[i]` copied byte-for-byte into
`dataset_rows.data`) avoids all of this**: it is an exact, lossless copy of what `config` already
held for that row, with zero reconstruction ambiguity, and `readDatasetRows` (Decision 9) simply
returns `{columns: dataset_schema, rows: dataset_rows.data ordered by seq}` — structurally identical
to `parseStaticPayload`'s existing output shape, not a re-derivation of it. This also makes the
content-level parity check (Decision 2 step 2, revised) exact equality rather than an approximate
reconstruction check. HEL-1077's future named-field write API can translate name↔position using
`dataset_schema` at that layer; it does not require the stored shape itself to be named.

### Decision 4: `data_sources.config` is cleared for migrated `dataset`-kind sources, gated on a verified parity check

HEL-1075's design.md states `config` "becomes unused after the migration" for `dataset`-kind sources.
Rather than leaving stale, silently-divergent duplicate data at rest, this migration clears `config` to
`'{}'::jsonb` for every migrated row — but **only after** an in-migration `DO $$ ... RAISE EXCEPTION ...
$$` block confirms **exact content-level equality** (not merely a row count) between
`jsonb_agg(dataset_rows.data ORDER BY seq)` and `COALESCE(config->'rows', '[]'::jsonb)` for every
migrated source (Decision 2 step 2 — corrected in round 3; an earlier draft of this Decision described
a row-count-only check, which round 2 already found insufficient). A mismatch aborts the whole
migration transaction rather than silently clearing a blob whose data didn't fully land in the new
table.

### Decision 5: Migration statement order — constraint drop precedes the UPDATE

Round 1 had tasks 1.6 (`UPDATE ... SET source_type = 'dataset'`) before 1.7 (drop/re-add the
constraint) — backwards. The existing `('rest_api','csv','static','sql','text','pdf','image')`
constraint does not accept `'dataset'`, so the `UPDATE` must run only after the constraint accepting
`'static'` is dropped, and the new constraint (accepting `'dataset'`, not `'static'`) is re-added only
after the `UPDATE` completes.

### Decision 6: `DataSourceRepository` persistence-boundary mapping (new — round-1 finding)

Not previously addressed anywhere in this ticket or the v0.8 spec, and load-bearing: without it, every
migrated row crashes `findAll` (`rowToDomain`'s `case other => throw IllegalStateException`), and every
new static-source creation fails (`domainToRow` still writes `"static"`, rejected by the new
constraint). This ticket adds, in `DataSourceRepository`:
- `rowToDomain`: map `row.sourceType == "dataset"` to `StaticSource` (same case as today's `"static"`
  branch — the Scala ADT member itself does not change; `DataSourceKind.Static` stays `"static"` on the
  wire per HEL-1073's future scope, only the **stored** DB string changes).
- `domainToRow`: write `"dataset"` (not `"static"`) for `StaticSource`.

This is a self-contained, backward-compatible internal mapping — it does not touch `DataSourceKind`,
`ConnectorRegistry`, or any wire-level `type` discriminator, all of which stay HEL-1073's scope.

### Decision 7a: Existing backend test seeds inserting `source_type = 'static'` directly must be migrated too

Round-3 finding: `grep -rn "'static'" backend/src/test --include=*.scala` finds 55 occurrences across 33
files (e.g. `ApiRoutesSpec.scala`, `PipelineAclSpec.scala`, `PipelineRunRoutesSpec`, `HookRoutesSpec`,
`DataSourceRoutesSpec`, `CombinedApplyProposalSpecBase`) that seed `data_sources` rows via raw SQL with
`source_type = 'static'`, at least 10 of which also seed non-empty rows into `config`. After this
migration: (a) any such seed insert fails the new CHECK constraint outright, or (b) if rewritten to
`'dataset'` without also moving its rows into `dataset_rows`, the swapped readers (Decision 9) would
silently see zero rows instead of failing loudly — a worse outcome than a compile/test failure. This
ticket must migrate every such seed to insert into `dataset_rows` (+ `dataset_schema`) alongside
`source_type = 'dataset'`, preferably through one shared test helper rather than 33 individual edits,
**without weakening any existing assertion** to accommodate the change. **Exception:** specs that
deliberately pin a pre-migration schema version (e.g. `V98PipelineRootsMigrationSpec`, which migrates
only up to a fixed earlier `V` number) correctly keep `'static'` — the executor must identify which
specs these are rather than bulk-replacing every occurrence.

### Decision 7: `create`/`refresh` (`updateStaticPayload` call sites) are retargeted to write `dataset_rows`, atomically

Redirecting both to `dataset_rows` (not left on the blob) avoids the two-store-must-stay-in-sync window
a "keep writing config" alternative would create, which would immediately diverge from every read call
site (Decision 9) on the very next refresh after this migration ships. Both paths run as a single DB
transaction (one `DBIO` composition under `withUserContext`), not sequential futures that can partially
fail:
- `createStatic`: insert the `data_sources` row, insert all rows into `dataset_rows`, upsert
  `dataset_schema` — one transaction. A mid-way failure must not leave a source with zero rows and no
  fallback blob. **`create`/`refresh` continue to call `upsertInferredSchema`** (`DataSourceService.
  scala:149`) inside this same transaction exactly as they do today — "upsert `dataset_schema`" is an
  addition alongside the existing `inferred_schema` write, not a replacement for it; the two columns
  serve different purposes (declared vs. runtime-derived) and both are still needed.
- `refreshStatic`: delete-then-reinsert the source's `dataset_rows` (replace semantics, matching the
  existing whole-payload-replace contract) **and** update `dataset_schema` to the new declared columns
  in the same transaction (round 1's tasks.md omitted the `dataset_schema` update on refresh; the spec
  delta already required it).

### Decision 8: Sources with `owner_id IS NULL` are migrated (schema/rows) but their `dataset_rows` are correctly invisible to any user under RLS

The real fixture contains one such row (`MyManualSource`, `owner_id NULL`). This is the **existing,
already-documented** posture for every owner-scoped table in this codebase (`V35`'s own header: "rows
without an owner are invisible to users and still accessible via the privileged pool"), not a new
policy invented for `dataset_rows` — the `dataset_rows_owner` policy (Decision 1) inherits this
automatically since it joins through `data_sources.owner_id`, and a `NULL = anything` comparison is
`NULL`/false in Postgres. No special-casing is needed in the migration; this is stated explicitly here,
and covered as an explicit fixture scenario (tasks 4.2), so it is not accidentally treated as a bug
during Execution.

### Decision 9: Scaladoc correction, and the concrete verification mechanism

`StaticSource`'s scaladoc is corrected to state: rows live in `dataset_rows` (post-migration),
`source_type = 'dataset'` (with `'static'` still accepted on the wire until HEL-1073's alias ships), and
`config` is unused/cleared for `dataset`-kind sources. The Scala type name is NOT renamed here.

**Before/after verification mechanism (round-1 finding: this was previously unexecutable, since the
legacy readers are removed in the same diff that would be needed to produce an "after").** Concretely:
1. Against `hel904-real-dump.sql` (already in-repo, real, contains genuine `static` sources including
   the `NULL`-owner row) applied through the **pre-migration** schema, capture golden output from all
   three legacy readers (`InProcessPipelineEngine`/`PipelineRowJson`, `SparkJobSubmitter`,
   `DataSourceService.previewStatic`) for every `static` source in the fixture, before writing any
   swap code.
2. Apply the migration and the reader swap.
3. Re-run the same three readers (now hitting `dataset_rows`) against the same fixture and diff against
   the step-1 golden values — rows, order, and types must match exactly.
Add a new repository method `readDatasetRows(id): Future[Option[JsObject]]` (returning the same
`{columns, rows}` shape `parseStaticPayload` already produces) that queries `dataset_schema` (raw
column, via a direct Slick query — like `readRawConfig`, this does NOT go through `rowToDomain`/the
`DataSource` ADT; `dataset_schema` is not added to `DataSourceRow`/the domain model in this ticket,
since that stays HEL-1073's territory) plus `dataset_rows` ordered by `seq`, and runs on the
**privileged pool** (`ctx.withSystemContext`), matching `readRawConfig`'s existing pool choice exactly
— `previewStatic` already calls `readRawConfig` under system context today (ACL is enforced earlier by
`findByIdOwned`'s ownership check, not by this read), so `readDatasetRows` preserves that same posture
for all three call sites (engine, Spark, preview) rather than introducing a new user-scoped path.
`dataset_rows.id` is generated via `gen_random_uuid()::text` at backfill time; `created_at`/`updated_at`
are backfilled from the owning source's own `created_at`/`updated_at` (Decision 2 step 1) since
individual row-level timestamps never existed in the blob. **`readDatasetRows` reads `dataset_schema`
and `dataset_rows` in a single statement** (a join or correlated subselect, not two sequential
queries), so a concurrent `refreshStatic` cannot interleave and hand a caller a schema/rows pair from
two different points in time.

## Risks / Trade-offs

- [Backfill `seq` ordering] → `WITH ORDINALITY` on the JSONB array preserves original order — the
  established idiom `V96` already uses for the same reason; safe.
- [`dataset_rows.data` as a **positional array**, aligned to `dataset_schema`'s column order, is an
  irreversible storage choice with a real ongoing cost] → deliberately decided now (Decision 3) rather
  than deferred, since HEL-1077/1078 build directly on it. The trade-off: `dataset_schema`'s column
  order is now **load-bearing** for `data` — any future column drop, reorder, or insert-in-the-middle
  (HEL-1077/1078's future schema-edit surface) must rewrite every affected row's `data` array in the
  same transaction as the `dataset_schema` change, or rows silently misalign against the schema
  (position N in `data` would no longer correspond to position N in `dataset_schema`). This is a
  real, non-hypothetical constraint on HEL-1077/1078's design, not merely a note; flag it there.
- [Decision 7's atomic-transaction requirement adds surface before HEL-1077 ships a "real" API] →
  accepted; the alternative (leaving `create`/`refresh` on the blob) was assessed as strictly worse.
- [`config` clearing (Decision 4) is irreversible within this migration] → mitigated by the in-migration
  `RAISE EXCEPTION` parity gate (Decision 2 step 2) — a mismatch aborts the transaction, so `config` is
  never cleared for a source whose backfill didn't fully land.
- [NO FORCE/FORCE bracket touches `data_sources`' RLS posture, even briefly, during migration] →
  identical, already-proven pattern used by `V94`/`V96` in production; the window is a single Flyway
  transaction, not a runtime window any app-pool query can observe.
