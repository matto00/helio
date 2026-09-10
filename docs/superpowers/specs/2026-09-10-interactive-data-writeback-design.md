# Interactive Data & Write-Back — v0.8 Design Spec

**Date:** 2026-09-10 · **Milestone:** Helio v0.8 — Interactive Data & Write-Back · **Brainstorm ticket:** HEL-643

## Summary

Helio today is a read-only window onto data acquired elsewhere. Every panel is a
projection of a materialized Output, and the flow `Source → Pipeline → Output →
Dashboard` runs in exactly one direction. A user who arrives without an existing
data source has nothing to do.

v0.8 inverts the arrow for the first time. A **form panel** writes rows into a
**dataset source**; a pipeline run picks them up; Outputs refresh; bound panels
update. Alongside it, **output controls** let a viewer re-parameterize what an
Output shows without editing the pipeline. Both are instances of HEL-643's
"panels that act, not just display", pointing in opposite directions.

## Motivation / evidence

> **Correction (2026-09-10, after HEL-1075).** An earlier revision of this spec
> stated that `StaticSource` rows live in "the DataType/snapshot row", with the
> `config` blob as a legacy second path. That was wrong in both halves: the
> DataType/snapshot concept was retired by the HEL-904/909 remodel, and
> `data_sources.config` is the only path, not the legacy one. The claim came from
> a stale scaladoc on `StaticSource` itself (tracked as HEL-1118). The sentences
> have been corrected in place rather than annotated, and the storage question
> they made look open is now answered below.

- **Zero-to-value is blocked on having data.** `StaticSource` is the only path to
  entering data by hand, and it has no first-class editing surface — it is
  created through the source wizard and thereafter effectively immutable.
- **`static` is already a misnomer.** `StaticSource` (`DataSource.scala:145`)
  stores its rows as a single `{columns, rows}` JSONB blob in
  `data_sources.config`, read back through
  `DataSourceRepository.readRawConfig`/`parseStaticPayload`. It is the only
  _mutable-shaped_ source kind, and its name asserts the opposite.
- **The plumbing already exists.** `HookTriggerService` runs a pipeline from an
  external trigger and owns no tables. `usePipelineRunEvents` streams run status
  over SSE. `usePanelPolling` refreshes panels on an interval. Per-pipeline
  cron/interval schedules ship. A panel-originated write is the same shape as a
  webhook trigger.
- **`analyze_pipeline` already walks the DAG symbolically without reading rows.**
  That is exactly the machinery a cost gate needs, and it exists.

## Decisions made in the 2026-09-10 design session

1. **A new first-class `dataset` source kind**, not an extension of `static`.
   `static` is migrated to it. The name should describe the primitive: a
   user-owned, schema-declared, writable row store.
2. **Write modes are `append` and `replace`**, selected per write, not per
   source. A form submit appends; a bulk edit or a pipeline write-back may
   replace.
3. **The dataset's schema is user-declared and authoritative.** This is the
   inverse of every other source kind, where schema is inferred. Writes validate
   against the declaration and are rejected on mismatch — datasets are the one
   place Helio must not infer, because there is no upstream to re-infer from.
4. **The input/counter panel is a configuration of the form panel, not a sibling
   kind.** One field-rendering system, one submit path. A counter is a numeric
   field with an increment affordance.
5. **A counter click appends an event row, it does not mutate a value.**
   Rows are `{occurred_at, delta, value}`. Time-series and metric Outputs come
   free off the same dataset, and every write stays an append.
6. **Output controls parameterize the read, not the panel.** They attach to the
   existing `output` panel kind as config; they never write.
7. **Auto-run is gated by an engine-estimated cost verdict**, not a user toggle
   and not always-on. `analyze_pipeline` gains a cheapness verdict; a write
   auto-runs only when it passes.
8. **All four new pipeline ops ship in one Flyway migration.** `pipeline_steps_op_check`
   is a drop/re-add CHECK constraint (see `V83__add_assert_op.sql`); parallel
   lanes each adding an op to it collide. One migration, one lane.
9. **Accessibility acceptance criteria are inline in every panel epic.** The
   general a11y sweep (HEL-353) defers to v0.12, but v0.8 introduces the largest
   batch of new interactive controls in the app's history and must not create the
   debt in the first place.

## Non-goals / explicitly deferred

- Real-time collaborative editing of a dataset (last-write-wins is acceptable).
- Row-level permissions within a dataset — dataset ACL is the existing resource ACL.
- Offline form submission queueing — belongs with v0.11 Mobile.
- Write-back to `sql`/`rest_api` sources. `upsert_source` targets datasets only.
- Anonymous submission on a public/shared dashboard. Deferred to v0.9 Distribution,
  where the abuse surface is dealt with as a whole.

## Concept model

```
form panel ──write──▶ dataset source ──▶ pipeline ──▶ Output ──▶ output panel
                            ▲                                        │
                            └────── upsert_source step ──────────────┘
                                                     output controls ─┘  (read-side)
```

Two directions of interactivity, one milestone:

|                | Write-side                    | Read-side                       |
| -------------- | ----------------------------- | ------------------------------- |
| Panel          | `form` (incl. input/counter)  | `output` + controls config      |
| Target         | Appends to a `dataset` source | Re-parameterizes an Output read |
| Effect         | New data exists               | Same data, different window     |
| Ticket lineage | new                           | HEL-915, HEL-1027               |

## Data model & migration

### Schema changes

Two migrations, both at the next free `V` numbers at implementation time
(`main` is at `V105__oauth_states.sql` as of 2026-09-10 — do not hardcode).

**Migration A — datasets.**

- `UPDATE data_sources SET kind = 'dataset' WHERE kind = 'static'` and re-add the
  `data_sources` kind CHECK constraint with `dataset` in place of `static`.
- New `dataset_schema jsonb` on `data_sources` (nullable; backfilled for migrated
  `static` rows from their existing inferred schema, which becomes the declaration).
- New table `dataset_rows`, **decided by HEL-1075** against reusing
  `data_sources.config`. Shape:
  `dataset_rows(id, data_source_id, seq, data jsonb, created_at, updated_at)`,
  with a forced RLS policy scoped through `data_source_id` to
  `data_sources.owner_id`, mirroring the existing `data_sources_owner` policy.
  Backfill from each source's current `config` blob, then stop writing `config`
  for `dataset`-kind sources.

  Three reasons, in order of weight: row-level addressing is a hard requirement
  HEL-1078 cannot get from a blob (`updateStaticPayload` replaces the whole
  array and there is no row identity, so there is nothing for a `WHERE id = ? AND
updated_at = ?` precondition to bind to); `append` is a first-class write mode,
  and a blob forces a read-modify-write of the entire payload per append, which
  races under concurrent writers such as two counter clicks; and the migration
  cost is smaller than this spec originally assumed — only three call sites read
  the blob, all through one repository method
  (`InProcessPipelineEngine:509`, `SparkJobSubmitter:169`,
  `DataSourceService.previewStatic:930`).

**Migration B — pipeline ops.** One drop/re-add of `pipeline_steps_op_check`
adding all four of `upsertsource`, `convertformat`, `analyzewithai`, `generatetext`,
following the established `V50`–`V83` pattern.

### Back-compat

`"static"` remains accepted on the wire as an alias for `"dataset"` for one
minor release, mapped at `DataSourceKind.parseKind`. `ConnectorRegistry`
registration changes kind; `DataSourceKind.All` is registry-derived
(HEL-484) so no allow-list edit is needed, and `ConnectorRegistrySpec`'s
drift-detection test will catch any divergence.

## Epics

### 1 — The `dataset` primitive _(foundation; blocks 2, 4, 5)_

Writable source kind with a declared schema; row-level write API
(`POST /api/data-sources/:id/rows` append, `PUT` replace, `PATCH`/`DELETE` per
row); the `static → dataset` migration and wire alias; and a dataset management
UI under Sources so a dataset is editable without a dashboard. Concurrency is
last-write-wins with an `updatedAt` precondition on row edits.

### 2 — Form panel

New `PanelKind` `form`, registered in `Panel.Registry` (`Panel.scala:109`) — the
allow-list is registry-derived, so registration is the only enumeration to
change. Field-type builder: text, textarea, number, date, select, checkbox,
file. Submit appends one row. Validation and required fields are enforced both
client-side and at the write API, against the dataset's declared schema.

The **file field** stores through the existing uploads backend
(`HELIO_UPLOADS_BACKEND`, local/gcs) and writes a `binary-ref` cell — the same
convention `ImageSource` already uses — so no new storage concept is introduced.

**Input/counter** is this panel with one field and a compact chrome: a numeric
field with `+`/`−` and a step size, appending `{occurred_at, delta, value}`.

A `form` panel binds to a source rather than an Output. It is the second panel
kind after `divider` that requires no Output binding, and `PanelType.Default`
(currently `Divider`, see `model.scala:141`) is untouched.

### 3 — Output controls & parameterized Outputs _(HEL-915, HEL-1027)_

Viewer-facing controls on an `output` panel: date range, axis limits, dropdown
filters, drill-down. Controls resolve in one of two ways, decided per control:

- **Refetch** — the control narrows a query the Output can answer from stored
  rows. Requires **HEL-1027 (server-side sort, filter and counts for Output
  rows)**, which is a hard prerequisite: today client-side row ops only see
  fetched rows, so a date-range control would filter the page it happens to
  hold rather than the dataset.
- **Recompute** — the control changes a parameter the pipeline consumed
  (a bucket width, a top-N bound). This runs the pipeline with an override and
  is subject to the same cost gate as epic 4.

Also lands **HEL-350 Panel Interactivity** whole (cross-filtering, drill-down,
fullscreen, richer tooltips) — the same "panels that act" story, and splitting
the epic across milestones would strand half of it.

### 4 — Write → run → refresh loop

- **Cheapness verdict.** `analyze_pipeline` gains a cost estimate and a boolean
  verdict. Deny on: any AI step, any remote fetch (`rest_api`/URL-backed source),
  estimated row count above a threshold, step count above a bound. Deny is the
  default for anything the estimator cannot classify.
- **Auto-run.** A dataset write whose downstream pipelines all pass the verdict
  schedules a debounced run. Failing pipelines surface a "run to update"
  affordance instead.
- **Fan-out.** Reuse the `usePipelineRunEvents` SSE channel; panels bound to an
  affected Output refresh on `succeeded`.
- **Optimistic state.** The writing panel shows its new value immediately with a
  pending affordance, reconciling on refresh. A counter must never feel laggy.

### 5 — `upsert_source` step

A terminal pipeline step that writes its input to a dataset source — creating a
new one or updating an existing one, `append` or `replace`. This closes the
loop: a pipeline's result becomes a dataset another pipeline can read.
Cycle detection is required (a pipeline must not write to a source it reads).

### 6 — File & AI steps

- `convertformat` — file format conversion (CSV↔JSON, etc.).
- `analyzewithai` — structured extraction/classification over content fields.
- `generatetext` — synthesize source data into a text Output.

All three route through the existing `com.helio.ai` `ClaudeClient`, which already
enforces `CLAUDE_MAX_TOKENS`, `CLAUDE_MAX_INPUT_TOKENS` and tier gating
(`HELIO_BETA_DAILY_MESSAGE_LIMIT`). **These steps are the reason epic 4's cost
gate exists** — an AI step must never be reachable by auto-run.

## Authorization & RLS

Dataset writes go through the existing resource ACL — a writer must be able to
edit the source. RLS policies extend to any new table exactly as the remodel's
did. Note the standing trap: **Flyway runs as the non-BYPASSRLS `helio` role in
production, while every local, CI, and prod-dump check runs as superuser and
masks RLS failures** (see the v0.7.x release incident). Any new table's policies
must be exercised under a non-superuser role before release.

## Testing strategy

- Round-trip: declare schema → submit form → append row → run pipeline → Output
  reflects it, end to end against a real dataset rather than a fixture.
- The cost gate needs a **failable** probe: a pipeline that the estimator must
  deny (contains an AI step) and one it must allow, with the mutation showing the
  deny arm actually fires.
- Migration: a real `pg_dump` fixture containing `static` sources, not a
  hand-built one — hand-built fixtures did not find the defects real dumps did in
  HEL-904.
- Concurrency: two simultaneous appends to one dataset both land.
- a11y: keyboard-only completion of every form field type, including the file
  picker and the counter, with labels asserted by computed accessibility name
  rather than by DOM presence.

## Delivery order

1. Epic 1 (dataset primitive) — blocks 2, 4, 5. Migration A first.
2. Epic 2 (form panel) and Epic 3 (output controls) in parallel — disjoint
   surfaces, though both touch panel config.
3. Epic 4 (write→run→refresh) after 1 and 2.
4. Epic 5 and Epic 6 — Migration B ships once, in whichever lands first.

**Serialization hazard:** epics 5 and 6 both add ops to
`pipeline_steps_op_check`. They must not run as parallel lanes with separate
migrations. Batch the constraint change into one migration owned by one lane.

## Open questions for implementation

- The concrete thresholds in the cheapness verdict. Start conservative (deny more
  than allowed) and loosen on evidence; the estimator is reusable later for
  scheduling and for showing users what a run costs.
