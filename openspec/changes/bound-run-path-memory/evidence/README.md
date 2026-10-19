# Evidence index (HEL-1660)

Only `*.summary.txt`, `*.txt` and `mutations.md` are committed (`*.log` is gitignored; each `.summary.txt` is the filtered transcript of the same-named `.log`). Forked test JVM `-Xmx768m` for every probe and heap run (`red-run-limits-xmx768m.javaoptions.txt`).

## Red first (unchanged code)
- `red-run-limits-xmx768m.summary.txt` — AC1: joins, unpivots, splits, chunking and unions produced 100,005 to 160,000 rows with no limit; the text-copying fan-outs ran out of heap and surfaced as "step execution failed"; a doubling concat built a 2 MB text.
- `red-fatal-errors-xmx768m.summary.txt` — AC7: an OutOfMemoryError (thrown or returned) became a step error; a StackOverflowError's cause was a boxed ExecutionException.
- `heap-run-4000000-xmx768m.summary.txt`, `heap-sweep-xmx768m.summary.txt` — the planned 4,000,000-cell budget peaked at 362 MB.

## Green
- `green-*.summary.txt` (targeted specs, late-finisher seams), `green-testfull.summary.txt`, `green-testfull-cycle2.summary.txt` (`sbt testFull`, 9368 succeeded).
- Budget sizing: `heap-sweep3/4/5-*.summary.txt`, `heap-sweep4-dedupe-report.txt`, and `heap-repeats-report.txt` (cycle 2: 3 repeats of AC6 and the just-under shapes at 2,600,000 and 2,800,000 cells; the final constant is 2,600,000, see design.md "Measured Budget"). `green-heap-report-3000000.txt` is the superseded cycle-1 value.

## Mutations
`mutations.md`: 25 entries (22 guards from cycle 1, 3 CI-guard mutations and a re-run of the empty-`retain` mutation in cycle 2), each red.

`superseded/` holds earlier runs that were replaced (a heap run that deadlocked on a spec bug; the first `testFull` with 4 late-finisher failures).
