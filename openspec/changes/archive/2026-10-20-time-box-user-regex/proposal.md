## Why

A user regex with catastrophic backtracking in `stringops extractRegex` or `assert regex` runs in exponential time on `java.util.regex` (measured: `^(.*a){12}$` takes 107 ms at 24 characters and 4.7 s at 32, about x2.4 per 2 characters). Since HEL-1630 a draft-preview walk holds one of the instance's two in-flight slots until it ends, so two such requests take draft preview down on an instance; in a real run (HEL-1660's path) the same pattern ties up the run. Owner ruling (escalation HEL-1676-1792518291055-95c8d3): time-box user regex evaluation, with a fixed 2 s budget per step and no environment override.

## What Changes

- Every user-regex match (stringops `extractRegex`, assert rule kind `regex`) reads its input through a deadline-checking `CharSequence`, so the backtracking engine itself stops when the budget is spent.
- One wall-clock budget of 2 s per step evaluation, shared by all rows of that step, fixed in code (no environment variable).
- When the budget is spent the step fails with a step error naming the step (id and kind) and the pattern; for `assert regex` this is a step error, not a rule result. Applies identically in draft preview, saved preview and real runs, because all three evaluate through the same step code and engine.
- Normal regexes behave identically: same `Pattern`, same `find()`, same groups; RE2/J is not used.

## Capabilities

### New Capabilities
- `pipeline-user-regex-time-box`: bounded-time evaluation of user-supplied regex patterns in pipeline steps.

### Modified Capabilities
<!-- none -->

## Impact

- Backend only: `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala`, `AssertStep.scala`, a new `RegexTimeBox.scala`, and backend tests. No API, schema, migration or frontend change.
