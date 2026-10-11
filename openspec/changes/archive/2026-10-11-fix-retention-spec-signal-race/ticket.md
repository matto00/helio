# HEL-1499: CI flake on main: OutputHistoryRetentionInFlightSpec signals historyReached before incrementing historyCalls (0 was not equal to 1)

## Description

Main CI went red on a5443584c (run 38150267950): backend (2) and ci-complete failed.

`OutputHistoryRetentionInFlightSpec` (added by HEL-1477, matto00/helio#946) failed on "release the guard when the
history part fails with a future, then run the next due pass": `0 was not equal to 1
(OutputHistoryRetentionInFlightSpec.scala:96)`.

**Likely cause (driver reading, verify it):** the test repo's `thinPass` override does
`{ historyReached.trySuccess(()); history(historyCalls.incrementAndGet()) }`. It completes the hand-off promise
*before* incrementing the counter. The test awaits `historyReached` on the test thread and then reads `historyCalls`,
which can still be 0 if the pool thread hasn't run `incrementAndGet` yet. Lines 74-75 have the same race, and so may
`payloadReached`/`payloadCalls`.

**Fix:** increment first, then signal (`val n = historyCalls.incrementAndGet(); historyReached.trySuccess(());
history(n)`), and the same for payload. This changes the test only; the service code isn't implicated, but confirm
that. Show the race deterministically, for example by delaying the increment in a mutation, so the fix is proven, not
just re-run green.

## Acceptance Criteria

- The race is reproduced deterministically on the unfixed code (a mutation that widens the signal-to-increment window
  makes the spec fail every time), with the log kept as evidence.
- The spec increments `historyCalls`/`payloadCalls` before completing `historyReached`/`payloadReached`; with the same
  widening mutation applied to the FIXED ordering, the spec passes.
- `OutputHistoryRetentionService` is examined for a real race; any found is filed as a separate ticket, not fixed here.
- Test-only, minimal diff; no inline FQNs; `[hel1468-guard]` appears in the sbt runs.

## Driver constraints

- Scope test-only and minimal. No service change in this PR.
- `nice -n 19`, MemAvailable check before any `sbt testFull`; shut down every sbt server started.
