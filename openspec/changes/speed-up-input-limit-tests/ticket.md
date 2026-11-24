# HEL-1831: Speed up the two HEL-1637 input-limit tests: the O(n^2) sizing helpers take 115-199 s

## Description

HEL-1821 regenerated the backend shard weights. The new weights show that two backend suites are each dominated
by one input-limit test that HEL-1637 added:

* `AssistantServiceFailureBudgetSpec`, the test "stop mid-turn on the input limit keeping the work so far, while a
  first-request overrun is still refused (HEL-1637)". It measured 115-199 s, and the suite weighs 153 s.
* `AssistantConversationRoutesTierSpec`, the test "refuse a first request over the input limit with nothing
  persisted, but keep the work of a turn that grows past it, after which every send is refused". It measured
  170-191 s, and the suite weighs 178 s.

The cause, as found in HEL-1821: the sizing helpers, `sized(target)` (`AssistantServiceFailureBudgetSpec.scala:176`)
and `sizedMessage(target)` (`AssistantConversationRoutesTierSpec.scala:148`), grow the input one word at a time.
Each step re-estimates a string of about 100k tokens, so the work is O(n^2).

These two suites alone keep the predicted heaviest backend CI leg 22.7 s over HEL-1758's 480 s headroom target
(341.7 s + 161 s). HEL-1821 has the evidence in `after-shard-plan.txt`.

This is a test-only fix. Do not change any test assertion, and do not change app code.

## Acceptance criteria

- [ ] Both tests keep exactly the same assertions, and each still proves its limit behavior. Show that by making
  each test fail against a mutation of the limit check.
- [ ] Each test's duration before and after the fix is stated, measured the same way: JUnit time from CI, or a
  local run in both cases.
- [ ] Optional: regenerate `backend/project/test-suite-weights.tsv` with the documented procedure once main runs
  include the fix.
