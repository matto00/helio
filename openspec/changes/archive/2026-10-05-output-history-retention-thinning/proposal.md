## Why

L1 (HEL-1271) writes one `output_snapshot_history` row per Output per real run, but nothing ever deletes them. Owner
ruling D4 bounds storage by thinning on purge — ≤1 point per 5 min within 24h, ≤1 per hour for 1–7 days, ≤1 per day
beyond, up to the owning tier's max age (free 30d, beta 90d, owner 365d). Without this leaf, history grows unbounded.

## What Changes

- New `OutputHistoryRetentionConfig` (env-driven, `PipelineRunGuardConfig` style): per-tier max-age days, the D4 bucket
  windows/widths, and the purge interval (default 60 min).
- New `OutputHistoryRetentionService` with `purgeIfDue(now)`: at most one `thinAndPurge` per interval per process,
  failure logged and never propagated.
- `PipelineSchedulerService.tick` calls it via a new nullable-defaulted constructor param (the
  `ProductEventRollupService` precedent); `Main.scala` wires it.
- `OutputHistoryRepository.thinAndPurge` (minimal change): the tier is resolved via `pipelines.owner_id` (the ticket's
  path) instead of `outputs.owner_id`, which differs for an Output an Editor grantee created on a shared pipeline; and
  a tier missing from `maxAgeByTier` falls back to the strictest cap in the map instead of never being purged.
- `CLAUDE.md` documents the new env vars.

## Capabilities

### New Capabilities
- `output-history-retention`: scheduled, tiered, time-bucket thinning and age purge of Output history.

### Modified Capabilities
- `output-snapshot-history`: the repository's thinning primitive resolves the tier through the pipeline owner and
  falls back to the strictest cap for a tier missing from the map.

## Impact

Backend only: `OutputHistoryRepository.scala` (one SQL join + cap fallback), `PipelineSchedulerService.scala`, `Main.scala`,
two new files under `services/pipelines/`, new specs, `CLAUDE.md`. No migration, no API, no frontend.

## Non-goals

- Payload history caps (L6), read API / compare (L3), alert baselines (L8).
- Cross-instance coordination of the hourly gate: the gate stays per-process; only the purge itself is serialised across instances by an advisory lock (see design).
