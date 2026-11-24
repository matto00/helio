## Context

Both helpers return `"word " * k` (or messages built from it) where `k` is the largest word count whose estimated
total, via the real `ClaudeTokenEstimator` (a tokenizer `countTokens` per message), is `<= target`. The current
walk starts at `k = target`, steps down by 1 while over, then up by 1 while `k + 1` still fits. Each step tokenizes
the whole ~100k-token input, so the walk is (steps) x (full tokenization).

The tests call the helper with `maxInputTokens - 5` (fits the first request, grows past the limit after a tool
round) and `maxInputTokens + 50` (refused before sending). Where the result sits relative to the target is what
the test depends on; the exact word count is not asserted anywhere.

## Goals / Non-Goals

Goals: same boundary semantics, same assertions, the cost of a handful of estimates per call.
Non-goals: app code, estimator changes, weights regeneration.

## Decisions

D1. Root cause is measured first, not assumed. Before any change, time each helper call alone (the existing code,
same targets) and each test via `testOnly` locally; record both. If the helper is not the dominant cost, stop and
re-plan (escalate) rather than optimize the wrong thing.

D2. Shape: bisection on `k` over `[lo, hi]` with `total(lo) <= target < total(hi)`, against the real estimator
(`total` as today, unchanged). The executor may choose a tighter seed (e.g. compute `k` from a measured
tokens-per-word slope, then correct by a few steps) if measurement shows it is simpler; either way the number of
full estimates must be O(log n) or O(1), and the result must equal the old helper's result.

D3. Boundary guard inside each helper: after computing `k`, `require(total(k) <= target && total(k + 1) > target)`
with a message naming target and the two totals. This is not a test assertion change; it guards the helper's
contract (the old loop guaranteed this by construction). Cost: two estimates.

D4. Equivalence probe (one-off, not committed as a test): run old and new helpers for both targets used by each
test and record that they return identical `k` (and identical totals). Committed as `equivalence-probe.txt`. The
probe code itself lives in scratch and is removed before commit.

D5. Mutation reds: mutate the limit check in app code temporarily (e.g. `ClaudeRequestBuilder.guardrailRejectTool`
/ `guardrailReject` comparison, and/or the mid-turn `input_budget` stop path in `AssistantService`) so the limit
is not enforced (or off by a margin larger than the helper's offsets), run each full spec file, record both tests
failing (`mutation-red-*.txt`), then revert. At least one mutation per test that the test detects; show the
first-request refusal and the mid-turn stop are both covered. Run with the NEW helpers so the reds prove the
fixed tests still detect it. Optionally also with the old helpers to show parity.

D6. Timing: same method before and after, local `sbt testOnly <Spec>` with `-J-Xmx3g`, `nice -n 19`, JUnit times
from `backend/target/**/test-reports/*.xml` (sbt 2 writes under `target/out/**`; the per-test `time` attribute). Recorded as `timing-before.txt` and
`timing-after.txt`. Run the full spec files (all tests), not `-z` filtered, so the numbers are per-test within the
real suite.

D7. (Design-gate notes, round 1.) Every evidence `testOnly` run uses
`nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly <FQN>"` and is judged by ScalaTest's summary
(`Tests: succeeded N, failed M` and failing names), never `$?` (sbt 2 can exit 0 on failure, HEL-1468/MISTAKES.md).
The bisection's `hi` seed is checked (`total(hi) > target`), failing loudly if not. The probe file is removed from
`backend/src/test` before commit (canonical copy in the main checkout's `.concertino/scratch/HEL-1831/`). D5 also
records one off-by-margin mutation (e.g. `> maxInputTokens + 100`) to show the +50/-5 offsets still discriminate.

## Risks / Trade-offs

- Non-monotonic tokenization of `"word " * n` would break bisection; D3's guard and D4's probe catch it.
- Local timings differ from CI's; the AC permits local-both-times.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or hook-invoked script is touched.
