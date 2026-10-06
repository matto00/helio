## Context

See proposal.md for the motivation. These are the existing pieces this change builds on, verified on main d9473814:
- `PipelineRunService` (~1403-1452) writes node by node. When `outputHistoryRepo` is set it calls
  `nodeSnapshotRepo.overwriteRowsWith(..., andThen = outputHistoryRepo.insertAction(entries))`, so the node's
  replace and its summary inserts run in one `withSystemContext` transaction (D9). It also has `nodeJsRows`,
  `nodeOutputs`, `configsById` (each Output's config), `runId`, `triggerSource` and `now` in scope.
- `output_snapshot_history` (V115) has a UUID primary key, sharing-aware RLS through
  `helio_can_access_pipeline(pipeline_id)` (ENABLE+FORCE) and an explicit grant to `helio_privileged`.
- `OutputHistoryRepository.thinAndPurge` (L2) runs on the privileged pool under `pg_try_advisory_xact_lock`.
  It resolves the tier as the pipeline owner's (`pipelines.owner_id -> users.tier`) and purges a tier missing
  from its map at the strictest cap. `OutputHistoryRetentionService` calls it at most once per purge interval.
- `OutputHistoryRetentionConfig.fromEnv` / `CsvLimits` (HEL-1221) are the env-driven config and cap precedents.
- `OutputCompare.validateConfig` runs on both config write paths (`OutputService:460`, `PipelineService:684`).
- The HEL-1282 guard scans only `OutputRepository`, `NodeSnapshotRepository` and `BinaryRefRepository`.

## Goals / Non-Goals

**Goals:** opt-in, capped, tier-retained payloads, atomic with the node write, readable only via the authenticated
sharing-aware route, RLS proven on the real two-role topology.
**Non-Goals:** compression, diffing, a UI/MCP toggle, summary-thinning changes, HEL-1285, and HEL-1282-guarded files.

## Decisions

**D-1 Schema (V116).** `node_payload_history` has these columns:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`. D8 rules out BIGSERIAL because of the TRUNCATE-cascade
  sequence landmine.
- `pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE`.
- `node_step_id TEXT NULL` and `root_id TEXT NULL`, with `CHECK ((node_step_id IS NULL) <> (root_id IS NULL))`
  mirroring V98. A root-bound payload therefore always carries its root, which removes the multi-root ambiguity
  HEL-913 R12 bans.
- `run_id TEXT NULL` with no FK (D7), `trigger_source TEXT NOT NULL`, `captured_at TIMESTAMPTZ NOT NULL`.
- `row_count INT NOT NULL`, `byte_size INT NOT NULL`, `rows JSONB NOT NULL`.

It has an index on `(pipeline_id, node_step_id, root_id, captured_at DESC)`. RLS is ENABLE+FORCE with four
policies on `helio_can_access_pipeline(pipeline_id)`, exactly as V115, plus an explicit `GRANT ... TO
helio_privileged`. The same migration also runs
`ALTER TABLE output_snapshot_history ADD COLUMN payload_id UUID NULL REFERENCES node_payload_history(id)
ON DELETE SET NULL` and indexes `payload_id`. Deleting a payload un-links its points and never deletes them.
FK checks and referential actions are not RLS-filtered. The migration is additive and backfills nothing.
Prod Flyway runs as the non-BYPASSRLS `helio` role, which owns V115's table, so `FlywayNonSuperuserMigrationSpec`
must cover V116.
*Alternatives rejected:* one payload per Output point (duplicates node rows; D1 says per node); keying by
`(node, captured_at)` with no link column (the read route would join on a timestamp).

**D-2 Opt-in.** Owner ruling Q2: `config.historyPayloads`. A new
`domain/history/PayloadOptIn.validateConfig` accepts an absent key, `null` or a boolean, and rejects anything
else with a `400`. It is chained next to `OutputCompare.validateConfig` at both call sites. `PayloadOptIn.enabled`
returns true only for `JsTrue`.

**D-3 Write path.** A new `NodePayloadHistoryRepository(ctx)` lives in a new file, so the HEL-1282 guard does not
apply. Its method `writeAction(...): DBIO[Option[UUID]]` runs inside the existing `andThen`:
1. Read the pipeline owner's tier: `SELECT u.tier FROM pipelines p JOIN users u ON u.id = p.owner_id`.
2. If the tier's run cap or age limit is 0, or the tier is unknown, return `None` with no serialization and no WARN.
   Only then check `rows.size` against the row cap, then build and measure the compact JSON against the byte cap
   (over either -> WARN, `None`); a node over the row cap is never serialized.
3. Otherwise insert, then delete at most ONE row: the single oldest payload beyond the node's newest N
   (`captured_at, id` order; predicate always includes `pipeline_id = ?` and `node_step_id = ?` or
   `node_step_id IS NULL AND root_id = ?`, never a bare `IS NULL`). Larger excess (a lowered cap) is left to the
   purge, so the run transaction never multi-row deletes (deadlock avoidance).
4. Return the new id.

In `PipelineRunService`, when any `nodeOutputs` opted in:
- Pass the rows and caps to `writeAction`, which measures after the tier check (step 2).
- The `andThen` becomes `payloadAction.flatMap(pid => insertAction(entries with payloadId = pid for opted-in
  Outputs only))`.
- `OutputHistoryInsert` gains `payloadId: Option[UUID] = None`, a defaulted field so the L8 and test call sites
  compile unchanged. `HistoryTable` maps `payload_id`.

When no Output on the node opted in, no array is built and nothing is measured, so the hot path costs nothing new.
The cap is applied to the compact JSON text, not the jsonb storage size, so it is deterministic before the
insert. Using the same `andThen` means a payload insert failure rolls back the replace (D9). D5 holds for free,
because this path is only reached for runs that write summaries.

**D-4 Config.** `PayloadHistoryConfig.fromEnv` reads these variables. A non-numeric or negative value falls back
to the default and logs a WARN, mirroring `OutputHistoryRetentionConfig`.
- `PAYLOAD_HISTORY_MAX_ROWS`: default 1000, minimum 1.
- `PAYLOAD_HISTORY_MAX_BYTES`: default 1048576, minimum 1.
- `PAYLOAD_HISTORY_MAX_RUNS_{FREE,BETA,OWNER}`: defaults 0, 10, 30.
- `PAYLOAD_HISTORY_MAX_AGE_DAYS_{FREE,BETA,OWNER}`: defaults 0, 7, 30.

A tier whose runs or age is 0 stores nothing.

**D-5 Retention.** `NodePayloadHistoryRepository.purge(now, config)` runs in one transaction under the SAME
`pg_try_advisory_xact_lock` key as `thinAndPurge` (HEL1272), so the two never contend across instances. It deletes:
- payloads older than the owner tier's age limit,
- payloads beyond the per-node newest-N for the owner's tier,
- every payload of a tier whose cap is 0 or that the config does not name, which fails closed and also covers
  downgrades,
- payloads that no `output_snapshot_history.payload_id` references.

`OutputHistoryRetentionService` calls `thinAndPurge` first and then the payload purge, inside the same
purge-interval gate. A payload-purge failure is logged and does not undo the summary purge. Because unreferenced
payloads are deleted, a payload is always reachable from a surviving point, and this change takes no position
on which point counts as 'previous' (HEL-1285).

**D-6 Read route.** `path("history" / JavaUUID / "rows")` sits in `OutputRoutes` next to `history` and
delegates to a new `OutputHistoryService.payloadRows(outputId, pointId, user)`:
1. Authorize with `outputRepo.findById`. No access returns NotFound "Output not found", the same as L3.
2. Load the point by `id AND output_id`, then its `payload_id`, then the payload, all on the privileged pool.
3. A missing point or a missing payload returns NotFound.

The response includes all of the payload's rows (at most the row cap). A non-UUID segment does not match the
route, so it falls through to 404. `PublicDashboardRoutes` gains nothing.

**D-7 Contract (skeptic round 1, CR 1-2).** Without point ids nothing could ever call D-6. `OutputHistoryPoint`
gains `payloadId: Option[UUID]`, and only the authenticated `OutputHistoryPointResponse` gains `id` (UUID) and
`hasPayload` (`payloadId.isDefined`). Both come from columns the existing query already reads, so the bounded
query count does not change. `PublicOutputHistoryPoint`, its writer and `public-output-history-response.schema.json`
stay unchanged, and a test asserts they carry no `id`, `hasPayload`, `payloadId` or `rows`.

Schemas:
- `output-history-response.schema.json` `historyPoint` gains `id` and `hasPayload`, both required, and keeps
  `additionalProperties: false`.
- New `output-history-payload-response.schema.json`: `{pointId, outputId, capturedAt, runId (string|null),
  triggerSource, rowCount, rows: array of objects}`, all required and none omitted.
- `config.historyPayloads` (`boolean | null`) is documented next to `compare` in `create-output-request`,
  `update-output-request` and `create-pipeline-transactional-output-request`.
- Verify with `npm run check:schemas`.

**D-8 Production wiring (skeptic round 2).** `Main` builds `NodePayloadHistoryRepository` and
`PayloadHistoryConfig.fromEnv()` once. `ApiRoutes` threads them, deriving from `dbContext` when absent like
`outputHistoryRepoOpt`, into `PipelineRunService` and `OutputHistoryService`. `OutputHistoryRetentionService` takes
both as non-defaulted parameters, so `Main` cannot compile without them. Task 6.9 builds `ApiRoutes` the way `Main`
does and observes a stored payload (the HEL-466 class of defect).

## Risks / Trade-offs

- [Up to ~30 MiB per opted-in owner node] → env-tunable caps, free stores nothing, over-cap WARN names the node.
- [Opting out keeps existing payloads until they age out] → acceptable; bounded at 7 or 30 days.
- [Privileged-pool writes mean RLS only guards direct app-role reads] → matches node_snapshots (D8); two-role spec.
- [The trim adds a DELETE per opted-in node write] → indexed, at most one row, bounded by the node predicate.
- [Residual deadlock: the trim's SET NULL may lock points in a different order than `thinAndPurge`'s delete; a run-side
  victim fails the node and run (D9)] → tiny window (one row, hourly purge); stated in the PR body.

## Migration Plan

V116 is additive; roll back by deploying the previous image. Never edit V116 once applied (Flyway checksum).

## Planner Notes

- Owner rulings 2026-10-05 (escalation answered via chat): Q1 `1mib-skip`, Q2 `output-config` (C1, C2).
- V116 confirmed free at design time. Self-approved: per-node trim; unknown tier means no payloads; opting out does not purge immediately; 404 (not 204)
  for a point with no payload.
- L2 thinning keeps one summary point per bucket, so unreferenced-payload purging means an active pipeline usually
  retains far fewer payloads than the D4 run cap. The cap is a ceiling, and L7 must not assume N consecutive runs.
- Pipeline delete has two cascade paths converging on `output_snapshot_history` (outputs -> points CASCADE;
  pipelines -> payloads CASCADE -> points SET NULL). A test proves the delete succeeds.
- HEL-1282: no edit to `NodeSnapshotRepository.scala` or `BinaryRefRepository.scala`. Any edit there must update
  the exemption table and `scripts/check-node-root-encoding.selftest.mjs` in the same commit.
