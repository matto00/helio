- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryRepository.scala` — tier via pipelines.owner_id join, strictest-cap fallback, pg_try_advisory_xact_lock around the purge (design note 1: implemented, one line of SQL, no migration)
- `backend/src/main/scala/com/helio/domain/model/model.scala` — `UserTier.all` (note 2), pinned to the CHECK values by OutputHistoryRetentionConfigSpec
- `backend/src/main/scala/com/helio/services/pipelines/OutputHistoryRetentionConfig.scala` — env config (new)
- `backend/src/main/scala/com/helio/services/pipelines/OutputHistoryRetentionService.scala` — CAS interval gate, failure logging (new)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala` — nullable param + zipped historyWork with Future.delegate + outer recover
- `backend/src/main/scala/com/helio/app/Main.scala` — construct and wire the service
- `CLAUDE.md` — nine OUTPUT_HISTORY_* env vars
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryRepositorySpec.scala` — fallback, shortest-cap, shared-pipeline cases (red first)
- `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryRetentionServiceSpec.scala` — 40-day hand-derived survivors, interval no-op, concurrent gate (new)
- `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryRetentionPrivilegedSpec.scala` — two-role privileged-pool spec, no re-grant (new)
- `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryRetentionConfigSpec.scala` — config + UserTier.all pin (new)
- `backend/src/test/scala/com/helio/services/pipelines/PipelineSchedulerServiceSpec.scala` — failure-through-tick cases (failed future, sync throw, outer recover)
- `openspec/changes/output-history-retention-thinning/evidence/` — red/green/mutation transcripts, measured tick duration (~20 ms, 2 Outputs x 1923 points)

## Cycle 2
- `OutputHistoryRepository.scala` — NOT-IN age-purge for tiers unnamed in the caps (CR1a); `UserTier.all` removed (model.scala back to base); lock key `private[persistence]`; DEBUG log on skip
- `OutputHistoryRetentionConfig.scala` — corrected false "fails to compile" comment
- `OutputHistoryRepositorySpec.scala` — unknown-tier (CHECK dropped on embedded PG, restored) and lock-skip tests
- `OutputHistoryRetentionConfigSpec.scala` — UserTier.all pin removed
- `PipelineSchedulerHistoryRetentionSpec.scala` — created in cycle 2, deleted in cycle 3 (see below)
- `OutputHistoryRetentionPrivilegedSpec.scala` — test renamed
- design.md / proposal.md / output-snapshot-history delta spec — advisory lock + unknown-tier fail-closed; `openspec validate --strict` valid
- evidence/cycle2-*.txt — red, green, mutations (skip-removed red; NOT-IN removed red; Pro-added stays green because nothing enumerates tiers)

## Cycle 3
- `PipelineSchedulerServiceSpec.scala` — the three HEL-1272 scheduler-failure cases moved back into the existing harness (imports merged into the existing `pipelines.{...}` import). The file is now 410 lines, past CONTRIBUTING's ~400 threshold: the PR body should propose splitting it (e.g. a shared-harness trait plus a retention spec).
- `PipelineSchedulerHistoryRetentionSpec.scala` — deleted
- `OutputHistoryRepository.scala` — Scaladoc re-wrapped, slf4j import ordered
- `OutputHistoryRepositorySpec.scala` — users.tier CHECK restore is now an unconditional nested try/finally
- evidence/cycle3-mutation-*.txt — service recover removed: failed-future + sync-throw cases red; both recovers removed: all three red; scheduler outer recover removed: the outer-recover case red
