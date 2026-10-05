## Standing Constraints

- [C1] The two-role privileged-pool spec never re-grants helio_privileged in its harness
- [C2] Expected survivors are hand-derived literals, never computed by re-implementing the bucket algorithm

## 1. Backend

### Backend
- [x] 1.1 `OutputHistoryRepository.thinAndPurge`: resolve tier via `pipelines.owner_id` (Decision 1); update the doc comment
- [x] 1.2 `thinAndPurge`: tier missing from the map falls back to the strictest supplied cap; empty map = no age purge (Decision 2)
- [x] 1.3 Add `OutputHistoryRetentionConfig` with `fromEnv(env = sys.env)`, defaults and fallbacks (Decision 3)
- [x] 1.4 Add `OutputHistoryRetentionService` with `tick`/`tickAt`/`purgeIfDue`, CAS-claimed interval gate, failure logging (Decision 4)
- [x] 1.5 `PipelineSchedulerService`: nullable defaulted param, zipped `historyWork` with outer recover (Decision 5)
- [x] 1.6 `Main.scala`: construct the service from `outputHistoryRepo`, `fromEnv()`, `SystemClock`; pass it to the scheduler
- [x] 1.7 `CLAUDE.md`: document the nine `OUTPUT_HISTORY_*` env vars in the production env table

## 2. Tests

### Tests
- [x] 2.1 Update L1's "only for tiers present in the map" case to the fallback expectation; add a dedicated fallback test (red on L1 SQL first)
- [x] 2.2 Shared-pipeline test: free Editor grantee's Output on an owner-tier pipeline survives at 40d (red on L1 SQL first)
- [x] 2.3 FakeClock 40-day free+owner survivors spec with hand-derived expected survivors (Decision 6)
- [x] 2.4 Second-tick-within-interval no-op spec that seeds new thinnable points between ticks
- [x] 2.5 Purge failure (failed future and synchronous throw) through `PipelineSchedulerService.tick`, log captured, candidate still fires
- [x] 2.6 Two-role privileged-pool spec with a non-BYPASSRLS app-pool check
- [x] 2.7 Config spec: defaults, invalid values, recent>=mid fallback, total tier map
- [x] 2.8 Record red/green + mutation evidence (join revert, fallback removal, gate removal, recover removal, app-pool purge)
- [x] 2.9 `nice -n 19 sbt testFull` green (at most 2 workers; Bash timeout 600000); report FirstRunRoutesSpec timeouts if any
