## Context

See proposal.md - Why. `StaticSource` rows are stored today as a single `{columns,
rows}` blob in `data_sources.config jsonb NOT NULL` (`V4__data_sources_and_types.sql`,
unchanged since). `DataSourceRepository.readRawConfig`/`parseStaticPayload` is the
one read path; `updateStaticPayload` is the one write path (whole-blob replace, no
per-row id). Three call sites consume it identically: `DataSourceService.previewStatic`
(protocol layer), `InProcessPipelineEngine.loadRowsWithStats`, and
`SparkJobSubmitter.loadDataFrame`. `data_sources` carries a forced RLS policy
(`data_sources_owner`, `owner_id = current_setting('app.current_user_id')`).

Live measurement (dev DB, 2026-09-10): 2124 `static` rows. Grouping by name prefix
and creation day shows clustering consistent with e2e/delivery-run fixtures (e.g.
707 rows named `HEL-912 Lanes Rejoin ...` created on a single day; the ten largest
name-prefix groups account for ~1300 of 2124 rows) — this is test residue, not
representative production usage; real datasets are expected to be small and
user-authored (see MEMORY: "shared dev DB is 94% test residue"). Row-count
distribution: avg 3.1 rows/source, max 220 rows/source, blob sizes in the
74–220-byte range for the sampled recent rows. No source in the sample approaches
a size where JSONB blob overhead would be a concern either way.

## Goals / Non-Goals

**Goals:**
- Decide the physical store for `dataset_rows` (new table vs. `data_sources.config`
  reuse), with the measurement that produced the decision.
- State what happens to the legacy blob read path (`InProcessPipelineEngine`,
  `SparkJobSubmitter`) under the chosen store.
- State whether row-level addressing is possible in the chosen store, since
  HEL-1078 needs per-row edit/delete with an `updatedAt` precondition.

**Non-Goals:**
- Writing the migration, the new table's Flyway script, or any write API — that is
  HEL-1077/1078/1080.
- Deciding the `dataset` schema-declaration format (v0.8 design spec Decision 3) —
  orthogonal to where rows physically live.

## Decisions

**Decision: introduce a new `dataset_rows` table; do not reuse `data_sources.config`.**

Rationale, in order of weight:

1. **Row-level addressing is a hard requirement HEL-1078 cannot get from the blob
   store.** `updateStaticPayload` replaces the entire `{columns, rows}` array; there
   is no row identity in the current shape. HEL-1078's `PATCH`/`DELETE` per row with
   an `updatedAt` precondition needs a stable row id and a per-row `updated_at` to
   compare against — retrofitting that onto a JSONB array (synthesizing an id per
   array element, tracking a per-element timestamp inside the blob, still replacing
   the whole blob under RLS on every single-row edit) is more complex than a real
   table, and loses Postgres-native optimistic-concurrency support (`WHERE id = ?
   AND updated_at = ?`).
2. **`append` is a first-class write mode (v0.8 design spec Decision 2), including
   from a counter panel and a pipeline `upsert_source` step.** A row-store table
   supports `INSERT` without reading/rewriting existing rows; the blob requires a
   read-modify-write of the whole payload for every append, which is a correctness
   hazard under concurrent writers (two counter clicks racing) that a table with
   per-row inserts does not have.
3. **The legacy blob-reading call sites are two, not many, and already funnel
   through one repository method.** `InProcessPipelineEngine.loadRowsWithStats`
   and `SparkJobSubmitter.loadDataFrame` both call `dataSourceRepo.readRawConfig`
   directly (bypassing the typed row model). Migrating both to a new
   `dataSourceRepo.readDatasetRows(id): Future[Seq[Row]]` (or equivalent) is a
   two-call-site change, not a broad blast radius — this materially lowers the
   cost of the "real table" option versus what the ticket's original two-store
   framing implied.
4. **Volume/size at measured scale does not favor the blob.** Real (non-residue)
   `static` sources are small (avg 3.1 rows) — a table adds no meaningful storage
   or query overhead here; this is not a "the blob is fine because writes are
   rare and small" case that would tip the decision the other way.

**Alternatives considered:**
- *Reuse `data_sources.config` as-is, add a synthetic per-row id inside the JSON
  array.* Rejected — solves the addressing problem on paper but keeps the
  whole-blob-replace-on-every-write hazard from (2), and still requires the
  `readDatasetRows`-shaped call-site migration from (3) to normalize accessors, so
  it captures none of a real table's benefit while keeping its main cost.
- *Reuse the (already-retired) `DataType`/snapshot concept.* Not available —
  confirmed retired under HEL-904/HEL-909 (see proposal.md and premise-validation
  evidence); not a live option.

**Legacy blob path:** both `readRawConfig`-based call sites migrate to read
`dataset_rows` once the table exists; `data_sources.config` for `dataset`-kind
sources becomes unused after the migration (Migration A in the v0.8 spec already
plans a `static → dataset` `kind` rewrite — the row-storage migration rides with
it: backfill `dataset_rows` from each source's current `config` blob, then stop
writing to `config` for `dataset` sources going forward). `CsvSource`/`RestSource`/
etc. keep using `config` unchanged — this only affects the `dataset` kind.

**Row-level addressing:** confirmed possible and is the primary reason for this
decision — a `dataset_rows(id, data_source_id, seq, data jsonb, created_at,
updated_at)` shape gives HEL-1078 exactly the `WHERE id = ? AND updated_at = ?`
precondition it needs, natively.

**RLS:** `dataset_rows` must carry a forced RLS policy scoped through
`data_source_id`'s owner (join to `data_sources.owner_id`, mirroring the existing
`data_sources_owner` policy), and per the standing prod trap (Flyway runs as the
non-BYPASSRLS `helio` role while every local/CI/prod-dump check runs as superuser
and masks RLS failures), the leaf ticket implementing this table must add an
explicit non-superuser-role test exercising the policy, not just a superuser
integration test — this is a requirement on HEL-1077/HEL-1080's leaf work, not
something this ticket implements.

## Risks / Trade-offs

- [Two-migration window: `dataset_rows` table lands before all read paths are
  migrated] → Migration A already sequences `kind` rewrite + `dataset_rows`
  backfill + call-site swap as one atomic unit per the v0.8 spec; no ticket should
  ship the table without also migrating both legacy readers in the same change.
- [A `dataset_rows` table adds a join for every dataset read that the blob didn't
  need] → acceptable at measured scale (avg 3.1 rows/source); revisit only if a
  real dataset grows into the hundreds-of-thousands-of-rows range, which is out of
  scope for v0.8.

## Migration Plan

Not implemented by this ticket. Sequencing for the leaf ticket(s) that do implement
it (informational, not binding beyond restating the v0.8 spec's Migration A):
1. Add `dataset_rows` table + forced RLS policy (new Flyway migration).
2. Backfill from `data_sources.config` for existing `static`/`dataset` rows.
3. Migrate `InProcessPipelineEngine.loadRowsWithStats` and
   `SparkJobSubmitter.loadDataFrame` off `readRawConfig` onto the new table.
4. `static → dataset` `kind` rewrite (per v0.8 spec Migration A), same or paired
   migration.
5. Retire `updateStaticPayload`/`readRawConfig` for the `dataset` kind once no
   caller depends on them.

## Planner Notes

Self-approved: choosing "new table" over "extend the blob" is a technical
implementation decision within this ticket's own charter ("decide... new table
vs. the existing snapshot store") — not an escalation-worthy scope change. No
external dependency, no breaking API change (nothing is shipped yet), no
architecture decision beyond what this ticket exists to make.
