## Why

Two HEL-1637 input-limit tests take 115-199 s and 170-191 s, which keeps the heaviest predicted backend CI leg over
HEL-1758's 480 s target. Their sizing helpers find the largest input that fits a token target by stepping one word
at a time and re-tokenizing a ~100k-token string on every step.

## What Changes

- `sized(target)` in `AssistantServiceFailureBudgetSpec` and `sizedMessage(target)` in
  `AssistantConversationRoutesTierSpec` find the same word count with O(log n) estimates instead of O(n).
- Each helper checks its own result is the boundary (fits the target, one more word does not), so a silent drift
  to the wrong side of the limit fails loudly.
- No assertion of either test changes; no app code changes.
- Committed evidence: before/after local durations, a probe that the new helpers return the same word count as the
  old ones, and red runs of both tests against a mutated limit check.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only performance fix (`skip_specs: true`).

## Impact

- Two backend test files under `backend/src/test/scala`.
- Evidence `.txt` files in this change directory.

## Non-goals

- Regenerating `backend/project/test-suite-weights.tsv` (needs main CI runs that include the fix; left out).
- Changing `ClaudeTokenEstimator`, the limit check, or any other app code.
- Speeding up any other test.
