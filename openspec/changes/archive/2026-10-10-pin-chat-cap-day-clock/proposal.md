## Why

The beta per-UTC-day chat cap buckets usage by `LocalDate.now(ZoneOffset.UTC)`, read from the real wall clock inside
`AssistantDailyUsageRepository.incrementIfUnderCap`. Specs that assert the exact cap (the (limit+1)th call is denied)
and read the counter back for "today" flake if a run straddles real UTC midnight: the calls land in two day rows,
the expected 429 becomes a 200, and the read-back queries the wrong day. Same class as HEL-1439/HEL-1471 (HEL-1473).

## What Changes

- `AssistantDailyUsageRepository` gains an injectable `Clock` (existing `com.helio.domain.util.Clock`), defaulting to
  `SystemClock`. The UTC day is derived from `clock.now()`. Production wiring is untouched, so behaviour is identical.
- `ClaudeRoutesChatGateSpec` and `AssistantConversationRoutesSpec` construct the repo with a pinned clock and read
  usage back for the pinned day; a wiring guard asserts the stored `usage_date` is the pinned date.
- The same pin is applied to every other spec that is boundary-sensitive (sweep: `AssistantDailyUsageRepositorySpec`,
  `AiPipelineQuotaGateSpec`, and any other constructor of the repo that asserts a count or a cap).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) — no spec-level behaviour changes; `skip_specs: true`.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/persistence/assistant/AssistantDailyUsageRepository.scala`
- Backend test specs listed above. No API, schema, migration or frontend change.

## Non-goals

- Changing cap semantics, the UTC day definition, or `ApiRoutes` wiring.
- Editing any `EmbeddedPostgres` startup line (HEL-1445 owns them).
- `PipelineRunGuardRepository` / in-memory rate limiters (covered by HEL-1439/HEL-1471).
