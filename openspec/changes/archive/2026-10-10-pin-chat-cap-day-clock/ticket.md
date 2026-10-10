# HEL-1473: Audit: beta per-UTC-day chat cap specs (ClaudeRoutesChatGateSpec, AssistantConversationRoutesSpec) may split the day bucket across real UTC midnight

## Description

Origin: HEL-1471's final skeptic (unverified). `ClaudeRoutesChatGateSpec` and `AssistantConversationRoutesSpec` assert
the beta per-UTC-day chat cap (`HELIO_BETA_DAILY_MESSAGE_LIMIT`) via a `ChatAccessService` built with no visible clock.
If the day bucket uses the real clock, a run straddling UTC midnight could split it and flake (the same class as
HEL-1439/HEL-1471).

## Acceptance Criteria

- Verify how the day bucket gets its time.
- If it's the real clock, add or inject a clock seam and pin it in those specs (red-first by forcing a midnight
  crossing, a probe).
- Loop proof judged by log, with the `[hel1468-guard]` line present.

## Driver constraints (owner/driver, binding)

- Production behaviour must not change: the default clock stays the system UTC clock.
- Specs that start embedded Postgres use `VerifiedEmbeddedPostgres.start` (HEL-1445 guard).

## Premise validation (Setup)

CONFIRMED: `AssistantDailyUsageRepository.incrementIfUnderCap` computes `LocalDate.now(ZoneOffset.UTC)` inline; no
clock seam on the repo, `ChatAccessService`, or `AiPipelineQuotaGate.Live`. The same real-clock read-back pattern also
exists in `AssistantDailyUsageRepositorySpec` and `AiPipelineQuotaGateSpec`.
