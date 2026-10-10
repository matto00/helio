- `backend/src/main/scala/com/helio/infrastructure/persistence/assistant/AssistantDailyUsageRepository.scala` — `clock: Clock = SystemClock` constructor seam; UTC day derived via `LocalDate.ofInstant(clock.now(), ZoneOffset.UTC)` (identical to prior value on SystemClock; ApiRoutes untouched)
- `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala` — pinned day clock (2026-01-01T12:00Z), read-back from pinned date, usage_date wiring guard in the cap test
- `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesSpec.scala` — pinned day clock, read-back from pinned date, usage_date wiring guard in the beta cap test
- `backend/src/test/scala/com/helio/infrastructure/persistence/assistant/AssistantDailyUsageRepositorySpec.scala` — pinned clock; countFor, "yesterday" seed (pinnedDate.minusDays(1)) and three RLS inline reads all from pinned date
- `backend/src/test/scala/com/helio/services/auth/AiPipelineQuotaGateSpec.scala` — pinned clock; countFor from pinned date

## D4 sweep (every `new AssistantDailyUsageRepository(` in backend/src/test)
- ClaudeRoutesChatGateSpec — pinned (beta cap + read-back)
- AssistantConversationRoutesSpec — pinned (beta cap)
- AssistantDailyUsageRepositorySpec — pinned (cap, yesterday, RLS reads)
- AiPipelineQuotaGateSpec — pinned (beta cap, countFor)
- RefinementRoutesSpec, DashboardAuthoringRoutesSpec, AuthoringTelemetrySpec, AssistantTelemetrySpec — NOT pinned. Real reason: their fixtures are owner tier only, so `incrementIfUnderCap` is never called and no day bucket is read or written.

## Per-spec isolation under the shared pinned instant
- ClaudeRoutesChatGateSpec, AssistantConversationRoutesSpec: fresh user per test (`newUser`/`newUserWithTier`), no two tests share a usage row.
- AssistantDailyUsageRepositorySpec: `cleanDb()` (TRUNCATE) in every test. AiPipelineQuotaGateSpec: `cleanUsage()` (TRUNCATE) at the start of every test.

## C4 grep (`grep -n LocalDate.now` over the four pinned specs)
(no output; exit status 1 = zero hits)

## Evidence
/home/matt/Development/helio/.concertino/runs/HEL-1473/evidence/ (probe-2.1/2.2 logs+diffs, mutation-3.2.log, loop-*.log, loop-summary.txt)
