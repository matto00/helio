## Why

HEL-1323 found a 50 ms real-time window that a slow DB round trip overran under 3-fork contention. That one flake
is why HEL-1287 runs CI at 2 forks per leg. Other backend specs use fixed sleeps and real-time windows. Some can fail
under load, and others silently stop proving anything under load. Until they are inventoried and fixed, a 3-fork
trial cannot tell a real fork-count problem from a known test race.

## What Changes

- An inventory of every backend spec site that relies on a fixed sleep or a real-time window (design.md), classified
  by what contention does to it: false failure (flake), false pass (vacuous), or nothing.
- Every flake-capable site is rewritten to an injected clock, a state wait or a test-controlled lock. That is three sites,
  plus `OutputRoutesSpec:756` (ScalaTest's 150 ms default -> a named 5 s state wait, ruled by the driver), including
  `DatasetWriteAutoRunEndToEndSpec`'s `>= 1000 ms` assertion.
- Every negative-observation site that has a cheap deterministic barrier is rewritten to that barrier, so contention
  can no longer turn it into a vacuous pass. That is six sites in five files.
- Each rewrite is proven with a delay-injection probe and a production mutation. Probes are temporary and never
  committed.
- After the Part 1 merge: a do-not-merge draft PR runs CI with `HEL924_TEST_GROUP_CONCURRENCY=3`, with at least 5
  serial runs. The flake rate and leg time are reported on the ticket, and the default is escalated to the owner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-only change with no spec-level behaviour change, so `skip_specs: true`.

## Impact

- Test sources only, under `backend/src/test/scala/**`, in 8 spec files plus at most one shared test helper. No production source, migration,
  schema or frontend change.
- `.github/workflows/ci.yml` changes only on the throwaway trial branch, never in this PR.

## Non-goals

- Making 3 forks the CI default. That is the owner's decision, escalated with the trial numbers.
- `DatasetWriteSubmitLatencySpec` (HEL-1344), `ConnectorCompletionServiceSpec` (HEL-1323) and `SparkJobSubmitterSpec`
  (HEL-1325) are already done.
- Lengthening any window or deadline, and any change to `playwright.config.ts` or `.gitignore`.
- Bounded state waits that already poll (2-30 s deadlines). These are recorded as low risk and left unchanged.
