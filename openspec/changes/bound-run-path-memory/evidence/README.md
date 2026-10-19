# Evidence index (HEL-1660)

Forked test JVM `-Xmx768m` (`HELIO_TEST_JVM_XMX=768m`; `red-run-limits-xmx768m.javaoptions.txt` shows the flag) for every probe and heap run.

## Red first (unchanged code)
- `red-run-limits-xmx768m.log` — AC1: join/unpivot/splittext/chunkbytokencount/extractheadings/union produced 160,000 / 100,005 / 150,000 rows with no limit; the text-copying fan-outs ran out of heap and were reported as "step execution failed" (OutOfMemoryError swallowed); a doubling concat built a 2 MB text.
- `red-fatal-errors-xmx768m.log` — AC7: an OutOfMemoryError was converted into a step error (thrown and returned), and a StackOverflowError's cause was a boxed `ExecutionException`.
- `heap-run-4000000-xmx768m.log`, `heap-sweep-xmx768m.log` — the live-cell budget red: the planned 4,000,000 cells peaked at 362 MB against the 192 MB bound.

## Green
- `green-run-limits-fatal-xmx768m.log`, `green-retention.log`, `green-service-limits-xmx768m.log`, `green-all-targeted-xmx768m.log`, `green-final-targeted.log`, `green-latefinisher.log`.
- `heap-sweep3/4/5-*.log`, `heap-sweep4-dedupe-report`, `green-heap-xmx768m.log`, `green-heap-report-3000000.txt` — the budget sweep and the final measurement (3,000,000 cells, worst shape 185.5 MB).
- `green-testfull.summary.txt` — `sbt testFull`: 9365 succeeded, 0 failed (filtered; the raw 15 MB transcript is not committed). `superseded/testfull-first-4-latefinisher-failures.summary.txt` is the earlier run whose 4 failures were the late-finisher seams (fixed in `LateFinisherSpecBase`).

## Mutations
- `mutations.md` (index) and `mutation-<name>.log` — one per guard, each red.

`superseded/heap-sweep2-hung-deadlock.log` is a heap run that deadlocked on a spec bug (a `synchronized` on the spec instance inside a lazy val); fixed, rerun as sweep3.
