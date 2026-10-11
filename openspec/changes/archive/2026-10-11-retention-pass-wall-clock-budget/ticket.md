# HEL-1477: After HEL-1435: give each output-history retention pass a wall-clock budget (or move it off the scheduler tick); move the test-only thinAndPurge drain to test support

## Description

Origin: HEL-1435 (matto00/helio#921, 1b765f59). The batched thin bounds each transaction (the longest transaction fell
from 109.6 s to 8.0 s on the S4 prod-class proxy, and temp spill fell to 0). But a whole pass still holds the scheduler
tick: the worst 20-batch pass is about 96.7 s on S4 prod-class, repeated for about 15 ticks during a deep-backlog drain.
Under the cold strict-IO model, even one batch per pass stalls the tick for minutes. Total work per cycle rose 1.6-5.4x,
because batching bounds the transaction, not the total. Measurements:
`openspec/changes/archive/2026-10-10-bound-history-thinning-batches/measurements.md`.

## Acceptance Criteria

- Add a wall-clock budget per pass (stop starting new batches past N seconds), or move retention to its own scheduled
  job, so that scheduled pipeline firing is never delayed by more than a stated bound. Prove the bound on the S4
  prod-class proxy (scratch DB only).
- Move the test-only `thinAndPurge` drain out of production code into test support.
- Polish:
  - Strengthen the row-limit split test. Today it only asserts that 2 or more batches carry seeded Outputs.
  - In measurements.md, state that `SET LOCAL work_mem` wasn't needed (0 spill at 25k rows).
  - In measurements.md, cite or drop "the first clone was the colder run".

## Driver context (owner-approved overnight queue)

- Validate the premise by measuring the stall on main the way HEL-1435 did:
  - local caps and `nice -n 19`;
  - at most two `sbt testFull` runs machine-wide;
  - a scratch DB only.
- Recommend either the wall-clock budget or the off-tick design, and justify it with measurements. Whichever is chosen
  must:
  - keep the advisory-lock semantics (HEL-1272/1343) and the restart-safe continuation;
  - not starve the run scheduler.
- A new env var goes into the CLAUDE.md table with its default and fallback behaviour.
- Changing a default that alters prod behaviour beyond the budget is an assumed product call: flag it.
- Tests:
  - red first;
  - a clock/promise seam, never real sleeps;
  - new specs use `VerifiedEmbeddedPostgres.start`;
  - `[hel1468-guard]` must appear in sbt runs;
  - no inline FQNs.
