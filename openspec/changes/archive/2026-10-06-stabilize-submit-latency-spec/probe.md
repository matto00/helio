# Probe summary (HEL-1344)

Owner ruling (C5): AC1 is met by a documented non-reproduction at the worker cap, with honest hypothesis status.
Nothing here claims a reproduction or a proven root cause. Raw logs lived in the session scratchpad and are not kept.

Harness: sbt pinned with `taskset -c 0,1` at nice 19; up to 3 burners pinned to the same 2 CPUs at nice 19, killed
only by recorded PID. Total workers at most 4.

| Probe | Method | Inversions of `p50(after) < p50(before) - 5` |
| --- | --- | --- |
| P1 | Unmodified spec, 6 runs with continuous burners | 0/6 |
| P1b | Unmodified spec, 20 runs with duty-cycle burners (busy 0.3-1.2s, idle 0.3-1.5s) | 0/20 |
| P4 | Unmodified-spec copy: burners during the before phase, killed at the before/after boundary by PID; 21 runs x 3 tests; forked JVM affinity mask 3 logged every run | 0/63 |
| In-JVM repeat | One JVM, 15 fresh fixtures, 2 spinner threads during the before phase only; 15 more without | 0/30 |

Whole-spec total 0/26. Smallest after-minus-before p50 gap in P1b: +51ms.

## Magnitudes
- Unloaded (warm, 12 cores), before p50 / after p50: appendFormRow 11/34, replaceRows 6/25, patchRow 6/22 ms.
  Example before samples: `25,14,14,14,13,12,12,12,11,11,11,11,11,10,10,10,10,9,11,10`.
- Pinned contention: before 10-37ms, after 77-133ms. Contention widens the gap.
- P2/P3 (appendFormRow, 4 repeats each): before p50 baseline 31-37ms, swapped order 14-25ms, interleaved 29-33ms.
  Warm-up bias is about 10-20ms, decaying over roughly the first 15 samples.
- P4 closest approach: appendFormRow before 112ms, after 110ms (gap -2ms against the 5ms floor). The stall had not
  cleared at the boundary: `after=498,346,801,1385,1167,757,547,92,113,...`. Pinning also slows the after path
  (75-100ms vs 25-34ms unpinned), so the cap could not produce a quiet, fast after phase.

## Hypotheses
- H1 (warm-up of the first-run path): present but 10-20ms; cannot by itself invert a 20-100ms gap. Not the cause alone.
- H2 (loaded before phase, quiet after phase): the only shape that fits before 36 / after 25; the supported
  explanation, unconfirmed because it was not reproduced.
- H3 (`triggerAutoRunAwaited` `.recover` degrading an evaluation failure to a fast no-op): 0 "triggerAutoRun failed"
  lines and every after-phase write returned exactly 2 denied pipelines across about 1500 awaited writes (P4 1260 plus
  234 in the modified-spec runs). Cannot be excluded for the lost HEL-1333 transcript.

The fix (deterministic denied-pipeline assertions, timing report behind `HELIO_MEASURE=1`) holds under any of them.
