# Post-fix memory measurements (task 4.1)

Setup: backend from this worktree (`sbt run`, forked JVM, cwd verified via `/proc/<pid>/cwd`), `-Xmx768m -Xms384m -XX:+UseSerialGC` (the Cloud Run shape: 1 GiB container, `MaxRAMPercentage=75`, 1 CPU), `nice -n 19`, one JVM at a time, throwaway driver (`curl` clients outside the JVM + `jstat -gc` at 200 ms, not committed). Real dev DB and local file store; every source, pipeline and dashboard created was deleted by exact id afterwards. Files generated at measurement time, not committed. `peak_used` is the sampled sum of eden+survivor+old, so it includes garbage not yet collected; `peak_old` is tenured (max 512 MiB at 768m).

## Defects found while measuring (fixed in this change)

1. The first re-measurement **OOM-killed the JVM** at N=2 wide 50 MiB: `DataSourceCsvSupport.decodeUtf8` allocates a `CharBuffer` the size of the file plus its `String` (about 200 MiB per request on top of two byte copies). Fixed: UTF-8 is validated through one small reusable buffer (`isValidUtf8`) and inference/preview decode only the lines they sample (`fromCsvBytes`, `parseCsvRowsBytes`).
2. design.md's claim that Pekko's global limit "bounds the whole multipart entity" is incomplete: `BodyPart.toStrict(timeout)` caps **each part** at the global 8 MiB `max-content-length` and fails with a 500 `EntityStreamException`, ignoring `withSizeLimit`. A route test with a real server showed `withSizeLimit` alone leaves a 20 MiB upload at 500. Fixed with `p.entity.toStrict(timeout, CsvLimits.entityLimitBytes)`.

## Upload path (infer then create, N concurrent clients, N cap = 2)

| Scenario (768m) | Result | peak_used MiB | peak_old MiB | GC |
|---|---|---|---|---|
| wide 50.7 MB (49,000 rows x 15 cols, 735k cells), N=2 | 200 + 201 both | 498-500 | 330-420 | 1 full GC at most, 0.03-0.13 s |
| same, N=4 clients | 2 x (200,201), 2 x **429 Retry-After** | 498 | 420 | 0.15 s |
| narrow 50.0 MB (25M rows x 1 col), N=2 | 413 naming the caps, no OOM, no body decoded | 296 | 128 | 0.01 s |
| at-cap 50k rows x 15 cols (3.7 MB), N=2 | 200 + 201 | 254 | 97 | 0 |
| at-cap 15k rows x 50 cols (3.7 MB), N=2 | 200 + 201 | 221 | 97 | 0 |
| wide 25 MB (735k cells), N=2 | 200 + 201 | 501 | 397 | 0.01 s |

Margin check: the wide 50.7 MB N=2 scenario also passes at **-Xmx512m -Xms256m** (two runs: peak_used 331 and 308 MiB, 3 and 1 full GCs, 0.4 s), i.e. the upload path fits with a 1.5x smaller heap than production.

## Run path at the caps (first-run build: pipeline apply + real run with per-row Slick INSERTs, N=2 concurrent builds by one user)

| Source shape | N | Wall | peak_used MiB | peak_old MiB | Full GCs / GC s | Outcome |
|---|---|---|---|---|---|---|
| 50,000 rows x 15 cols (750k cells, 3.7 MB) | 2 | 6.1 s | 623 | 430 | 3 / 1.7 | both 201 |
| 15,000 rows x 50 cols (750k cells, 3.7 MB) | 2 | 4.8 s | 562 | 452 | 2 / 1.3 | both 201 |
| 49,000 x 15 (735k cells, **25.5 MB**) | 2 | 7.0 s | 717 | 512 (full) | 6 / 2.6 | both 201, near the cliff |
| 49,000 x 15 (735k cells, **50.7 MB**) | 1 | 5.1 s | 547 | 411 | 1 / 0.6 | 201 |
| 49,000 x 15 (735k cells, **50.7 MB**) | 2 | 20.3 s | 741 | 512 (full) | 43 / 17.2 | **GC thrash, both requests 503 at the 20 s request timeout**; the builds finished later in the background and the JVM survived |

## Reading

- The upload path (the ticket's literal question) fits N=2 at 768m with margin (also at 512m); narrow files are rejected cheaply.
- The row/cell caps protect against many tiny cells but not against **bytes x cells**: a file at the byte cap with its cells at the cell cap (about 68 bytes per cell) costs the run path roughly 410 MiB of old gen per run, so two concurrent runs of such files thrash a 768 MiB heap. design.md's run-path figures used small cells. The 25 MB variant already sits at the tenured limit with two runs.
- Options for the owner are in the escalation returned with this file.

# Re-measurement at the 15 MiB byte cap (owner ruling: option a)

Same setup (768m/384m, SerialGC, nice, one JVM, real dev DB; all created sources, pipelines and dashboards deleted by exact id, uploads dir verified identical afterwards). Densest shapes that fit both the caps and 15 MiB: 49,000 rows x 15 cols at 19-byte cells (14.7 MB, 735k cells) and 15,000 rows x 50 cols at 19-byte cells (15.0 MB, 750k cells).

| Scenario | N | Wall | peak_used MiB | peak_old MiB (max 512) | Full GCs / GC s | Outcome |
|---|---|---|---|---|---|---|
| upload infer+create, 49k x 15 (14.7 MB) | 2 | 0.7 s | 197 | 147 | 1 / 0.15 | 200 + 201 both |
| upload infer+create, 15k x 50 (15.0 MB) | 2 | 0.2 s | 257 | 210 | 0 / 0.02 | 200 + 201 both |
| first-run build (real run), 49k x 15 | 2 | 6.2 s | 626 | 465 | 4 / 1.75 | both 201 |
| first-run build, 15k x 50 | 2 | 5.7 s | 658 | 497 | 4 / 2.0 | both 201 |
| first-run build, 15k x 50 (repeat) | 2 | 5.4 s | 601 | 496 | 4 / 1.87 | both 201 |
| first-run build, 49k x 15 (repeat) | 2 | 6.8 s | 711 | 495 | 6 / 2.61 | both 201 |

Reading: no OOM and no thrash (the 50 MiB file had 43 full GCs and 503s), but the tenured generation sits at about 97% of its 512 MiB maximum with 4-6 full GCs per pair of runs and peaks of 600-711 MiB sampled used heap. The run cost is dominated by the cell count (the 3.7 MB at-cap files cost about as much: 623 MiB), not by bytes, so the byte cap is not the lever that buys more margin; the cell cap is.

# Final live check at the ruled caps (15 MiB / 50,000 rows / 300,000 cells)

Running app from this worktree, light and dark themes. First-run drop zone: over-byte file shows the client pre-check copy, over-row and over-cell files show the server 413 message naming 15 MiB / 50000 rows / 300000 cells, with no Retry button. AddSourceModal: 413 message shown for all three. First-run 429 (mocked response) shows "Too many requests right now" with a Retry button. Real 429: 4 slow concurrent uploads gave 200, 200, 429, 429. N=2 concurrent infer of a 14.1 MB / 300k-cell file: 200 + 200 in ~0.06 s each. Test user and generated files removed; uploads dir unchanged.
