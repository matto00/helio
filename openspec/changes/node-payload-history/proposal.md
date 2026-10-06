## Why

L1 (HEL-1271) records a per-Output summary of every real run, but not the rows themselves, so nothing can show
what an Output's table looked like at a past run. L7's run scrubber and changed-rows highlight need those rows.
Owner rulings D1/D4 make full row payloads opt-in, size-capped and tightly retained per tier.

## What Changes

- V116 creates `node_payload_history`: one JSONB array of rows per materialized node per run. It also adds a
  nullable `output_snapshot_history.payload_id` that links a summary point to its payload.
- New opt-in flag `outputs.config.historyPayloads` (boolean, default off), validated on every config write.
- On a real, successful run, a node's payload is written in the same transaction as its snapshot replace
  (D9), but only when an Output on the node opted in and the pipeline owner's tier allows payloads.
- Caps (owner ruling, 2026-10-05): at most `PAYLOAD_HISTORY_MAX_ROWS` (1000) rows and
  `PAYLOAD_HISTORY_MAX_BYTES` (1 MiB) serialized. A run over either cap stores no payload, still writes its
  summary, and logs a WARN. Payloads are never truncated.
- Tier caps (D4): free 0, beta 10 runs / 7 days, owner 30 runs / 30 days, enforced at write time per node and
  re-enforced by the L2 retention pass. The pass also drops payloads that no surviving summary point references.
- `GET /api/outputs/:id/history/:point/rows` returns a stored payload. It is authenticated only, never public.

## Capabilities

### New Capabilities
- `node-payload-history`: opt-in, capped, tier-retained storage of full node row payloads per run, and the
  authenticated read endpoint for them.

### Modified Capabilities
- `output-history-api`: authenticated history points gain `id` and `hasPayload`, so the payload route is reachable;
  the public history requirement states explicitly that no point id, payload linkage or payload route is exposed.

## Impact

- Backend: `Main.scala` and `ApiRoutes.scala` (wiring), a migration, `PipelineRunService` (write path), a new `NodePayloadHistoryRepository`,
  `OutputHistoryRepository` (`payload_id`), `OutputHistoryRetentionService`, `OutputRoutes`, config validation in
  `OutputService` and `PipelineService`, and a new env-driven config.
- `NodeSnapshotRepository.scala` and `BinaryRefRepository.scala` are not edited, so the HEL-1282 guard tables are
  unchanged.
- Contract: `schemas/outputs/output-history-response.schema.json` (point `id`, `hasPayload`), a new
  `output-history-payload-response.schema.json`, and `config.historyPayloads` in the three Output-config request schemas.
- `helio-mcp/src/types.ts` history point mirror.
- Docs: `CLAUDE.md` env-var table and endpoint list.

## Non-goals

- No UI or MCP toggle for `historyPayloads` (L7 is the consumer).
- Does not define 'previous' after thinning (HEL-1285).
- No public payload access, ever (D8).
- No payloads for dry runs, previews, blocked or failed runs, or the HEL-947 backfill (D5).
