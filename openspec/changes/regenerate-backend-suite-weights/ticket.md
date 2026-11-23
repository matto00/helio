# HEL-1821: HEL-1803 tidy: regenerate backend test-suite weights for the 8 new spec classes; fix two stale "above/below" comments

## Description

origin_kind: followup
origin_ticket: HEL-1803 (PR matto00/helio#1226, merged as 0954ea735). The owner chose a standalone ticket.

HEL-1803 split `ClaudeClientSpec`, `AssistantServiceSpec` and `AssistantConversationRoutesSpec` into 8 new spec
classes. Two leftovers:

1. **Backend shard weights.** `backend/project/test-suite-weights.tsv` has no rows for the 8 new classes, so they take
   the median weight. Regenerate it with the repo's documented procedure, from CI artifacts or timing data, not by hand.
2. **Comments that point to the wrong place.** The `ClaudeClient` scaladoc refers to "`guardrailReject` above", which
   moved to `ClaudeRequestBuilder`. The routes fixture refers to "tier tests below", which moved to another spec file.
   Point both at the new places.

## Acceptance criteria

- [ ] Every one of the 8 classes has a measured weight row.
- [ ] Before and after shard balance is stated: the longest shard and the mean, from the same source.
- [ ] Both comments are correct.

## Driver context (claims to verify)

- The 8 classes: `ClaudeClientFailureBudgetSpec`, `ClaudeClientToolLoopSpec`, `ClaudeClientToolRequestSpec`
  (com.helio.infrastructure.ai), `AssistantServiceFailureBudgetSpec`, `AssistantServicePromptHistorySpec`,
  `AssistantServiceSearchRepairSpec` (com.helio.services.assistant), `AssistantConversationRoutesTierSpec`,
  `AssistantConversationRoutesTurnSpec` (com.helio.api.routes.assistant).
- HEL-1625's main push run 45023531045 (07a118001): backend (1) failed, reportedly the 660 s ci-sbt deadline with no
  failing test, stalled in an assistant spec. State whether the missing weights put the assistant specs in one leg.
- If regeneration needs CI runs on the PR, use no more than needed + 1. Backend test config + comments only; no app
  code, no migration.
