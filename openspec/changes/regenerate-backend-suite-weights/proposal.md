## Why

HEL-1803 split three assistant specs into 8 new classes, but `backend/project/test-suite-weights.tsv` was not
regenerated, so the LPT shard packer (`backend/project/TestShards.scala`) prices each new class at the median weight.
The requirement "Backend shard packing weights reflect current suites" (`openspec/specs/backend-ci-test-execution`) is
violated, and a backend leg (main run 45023531045, leg 1) has since hit ci-sbt's 660 s deadline. Two comments the split
left behind also point at code that is no longer where they say.

## What Changes

- Regenerate `backend/project/test-suite-weights.tsv` with the documented procedure (`extract-fresh-junit.py` +
  `gen-test-suite-weights.py`) from the JUnit artifacts of recent complete, green main push runs that include the
  split (at or after 0954ea735). Every suite the build discovers, including the 8 new classes, gets a measured row.
- Record and commit the before shard plan and balance before regenerating, then the after plan, with the longest leg
  and the mean leg computed from the same measured durations.
- Fix the stale cross-references: the `ClaudeClient` scaladoc's "`send`'s `guardrailReject` above" and the
  `AssistantConversationRoutesFixture` comments that say tests or definitions are "below" in that file when they now
  live in `AssistantConversationRoutesTierSpec` (or above, in the fixture itself).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The existing requirement is applied, not changed; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `backend/project/test-suite-weights.tsv` (CI shard assignment only; no test, timeout or leg-count change).
- Comments in `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeClient.scala` and
  `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesFixture.scala`.
- No app behavior, no migration, no workflow change.

## Non-goals

- Adding a backend leg, changing timeouts, deadlines or `HEL924_TEST_GROUP_*` (owner ruling HEL-1287 C6).
- Changing `gen-test-suite-weights.py`, `extract-fresh-junit.py` or `TestShards.scala`.
- Root-causing or fixing an assistant-spec stall; if the evidence shows a real hang rather than load, report it.
