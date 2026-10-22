# Evidence index (HEL-1679)

Forked test JVM `-Xmx768m` (`maxMemory MB: 768`) for every heap run; `*.summary.txt` are the filtered transcripts (the `.log` files are not committed).

## Red first (unchanged main code, before any main-code edit)
- `red-fewrows-xmx768m.summary.txt`: `fewrows-utf16-200` real 294.8 / 294.8 MB (dry 93.6), `fewrows-utf16-20` real 256.4 / 256.4 MB (dry 133.4), the 1-row shape refused.
- `red-payload-rendered-first-xmx768m.summary.txt`: the payload-opted-in 200-row shape with the payload rendered before it is measured (mutation M11): 361.6 MB.

## Green (single-CPU, cycle 2)
- `green-full-regression-1cpu-xmx768m.summary.txt`: all shapes, 2 repeats, one CPU (maxMemory 742). `green-testfull.summary.txt`: `sbt testFull`.

## `MaxRowRenderChars` = 2,000,000 certification (design.md "Measured Results")
- `cert-2000000-1cpu-jvm-a-xmx768m.summary.txt`, `cert-2000000-1cpu-jvm-b-xmx768m.summary.txt`: 12 repeats each of `rowwidth-base` and `rowwidth-at-limit`, one CPU.

## Superseded (cycle 1: 4,000,000, multi-CPU G1 and stress runs)
`superseded/`: not production-representative; kept for the record.

## Mutations
`../mutations.md` and `mutation-run.txt` (cycle-2 re-run of all 14).
