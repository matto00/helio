## Context

Prod: Cloud Run `--memory=1Gi --cpu=1 --concurrency=80 --max-instances=2`; JVM `-XX:MaxRAMPercentage=75` => ~768 MiB heap; a 1-CPU JVM picks SerialGC. Pekko `max-content-length` default 8 MiB; no override. Multipart CSV routes buffer the whole entity (`toStrict` + `Sink.seq` + `.toArray`).

Multipart upload routes enumerated from code: `POST /api/data-sources/infer` (CSV), `POST /api/data-sources` multipart (CSV + text/pdf/image types, own per-type caps), `POST /api/uploads/image` (10 MiB cap), `POST /api/panels/:id/submit` multipart (10 MiB). Only the first two carry CSV and the first-run drop zone uses only those (via `inferAndCreateCsv`). Limit applies to the CSV routes only; the 10 MiB routes are unchanged.

## Measurements (throwaway harness, -Xmx768m -Xms384m, nice, EmbeddedPostgres; scratch deleted)

Initial exploration, on the pre-change code with a 50 MiB file (single request, smallest surviving heap): wide 50 MiB 412 MiB, narrow 50 MiB 866 MiB; N=3 wide 50 MiB OOM; narrow 50 MiB N=1 OOM. Cause: byte copies (~2x) + CharBuffer/String (2-4x) + `splitCsvLines` per-line Strings although only 101 lines are used.

Run path (real run incl. per-row Slick INSERTs, N=2 concurrent, SerialGC, secs): wide(16c) 50k rows 5.3, 100k 36 (26 GC), 200k OOM; medium(6c) 100k 5.4, 200k 15, 400k OOM; narrow 200k 7.3, 400k 20, 800k OOM; wide50(50c) 12.5k rows 5.2, 25k 11.7, 50k OOM. Cliff ~1.5M cells (rows x cols) regardless of shape; GC thrash from 0.8M cells. A byte cap alone never binds on narrow files (a narrow 50 MiB file is ~13M rows).

## Cap-selection measurements (N=2 concurrent first-run builds incl. per-row INSERTs; SerialGC, nice)

All files are ~14.5-14.9 MB fat-cell files; every run returned 201+201 with no OOM and no 503. Columns: wall s / peak_used MiB (sampled eden+survivor+old) / peak_old MiB / full GCs / full-GC seconds.

### -Xmx768m -Xms384m

| Cap | Shape (rows x cols) | Wall | peak_used | peak_old | Full GCs | GC s |
|---|---|---|---|---|---|---|
| 500k | 50000x10 | 5.1 | 641 | 463 | 3 | 1.36 |
| 500k | 10000x50 | 3.6 | 596 | 468 | 1 | 0.73 |
| 500k | 33000x15 | 4.1 | 605 | 499 | 2 | 1.07 |
| 400k | 50000x8 | 4.7 | 526 | 449 | 3 | 1.09 |
| 400k | 8000x50 | 3.3 | 614 | 496 | 2 | 0.89 |
| 400k | 26000x15 | 3.1 | 567 | 484 | 1 | 0.68 |
| 300k | 30000x10 | 3.8 | 454 | 404 | 3 | 0.91 |
| 300k | 6000x50 | 2.4 | 597 | 463 | 1 | 0.56 |
| 300k | 20000x15 | 2.4 | 547 | 464 | 1 | 0.54 |
| 200k | 20000x10 | 2.9 | 502 | 356 | 2 | 0.57 |
| 200k | 4000x50 | 1.9 | 594 | 453 | 1 | 0.39 |
| 200k | 13000x15 | 1.8 | 530 | 474 | 1 | 0.39 |

Prior 750k cells / 15 MiB: peak_used 601-711, peak_old ~495, 4-6 full GCs, 1.75-2.6 s GC. Prior 50 MiB / 735k cells at N=2: 43 full GCs, 17 s GC, 503 s. Upload (infer+create) N=2 at 15 MiB: peak_used 197-257 MiB.

### -Xmx512m -Xms256m (min-viable-heap check)

| Cap | Shape | Wall | peak_used | peak_old | Full GCs | GC s |
|---|---|---|---|---|---|---|
| 300k | 6000x50 | 3.6 | 397 | 298 | 4 | 0.97 |
| 300k | 20000x15 | 2.8 | 451 | 315 | 2 | 0.71 |
| 500k | 10000x50 | 5.1 | 404 | 338 (pinned at max 341) | 6 | 1.64 |
| 500k | 33000x15 | 5.5 | 492 | 341 (pinned) | 8 | 2.44 |

### Why min-viable heap is the margin metric

A SerialGC sampled peak includes garbage not yet collected, so it is a poor margin metric: at 768m the sampled peak stays ~450-600 MiB at ~15 MB at every cap from 200k to 500k cells (bytes and SerialGC garbage dominate), so the cap choice barely moves it. The honest margin claim is the smallest heap in which the run still passes without pinning old gen: N=2 at 300k cells passes in 512m with the old gen at ~300-315 MiB of 341 (about a 1.5x heap margin relative to production's 768m), whereas at 500k cells the old gen is pinned at its 512m maximum with 6-8 full GCs. Hence 300,000 cells.

## Decisions

D1 Caps (final, owner-ruled after the measurement rounds below): bytes 15 MiB (env `CSV_MAX_FILE_SIZE_BYTES`), rows 50,000 (env `CSV_MAX_ROWS`), cells 300,000 (env `CSV_MAX_CELLS`). The earlier draft (50 MiB / 750,000 cells, ">=2x margin") is **retracted**: with real byte sizes the run path at 735k cells and 50 MiB thrashed at N=2 (43 full GCs, 17 s GC, 503s), and even 15 MiB / 750k cells ran with the old gen at ~97% of its maximum and 4-6 full GCs. The run path is bounded by cells (and bytes together), so the cell cap is the lever. This narrows the ticket's "up to 50 MiB succeeds" AC to "up to 15 MiB AND within 50,000 rows / 300,000 cells". CsvLimits is TEMPORARY pending HEL-1257 (streaming run path); raising any cap requires re-measuring N=2 at 768m and the min-viable heap.

D2 Single source of truth: a backend object `CsvLimits` owns bytes/rows/cells and derives the Pekko entity limit = maxBytes + 1 MiB multipart-overhead margin. It is exposed via authenticated `GET /api/data-sources/csv-limits` -> `{maxBytes, maxRows, maxCells}`. The frontend removes its hard-coded constant, fetches the limits (cached in a module-level promise) and prechecks file size; if the fetch fails it skips the client precheck (the server 413 is authoritative). Chosen over a shared JSON/generated constant because the limits are env-overridable and the Docker/sbt build context does not share files with the frontend; the endpoint is the only mechanism that cannot drift from the running backend. A backend test pins `entity limit = maxBytes + margin`; a frontend test pins use of the fetched value.

D3 Enforcement: `CsvLimits.check(bytes)` scans bytes once with no allocation: byte length, newline count (rows, header excluded; counts physical lines so quoted multi-line cells over-count - conservative), column count from the first line. Applied in createCsv, infer, createCsvUrl (after fetch), refresh, and at run time in the CSV load path (`loadCsvRowsFromBytes` callers: dry/real run, preview step/outputs), `previewCsv` and the first-run builder, returning a clear `ServiceError` (413-class: `PayloadTooLarge`) naming byte, row and cell caps. Stored oversize files fail with that message rather than OOM. Over-the-wire entity too large -> 413 `ErrorResponse` via `withSizeLimit` plus an `EntityStreamSizeException` mapping in the route (never reaches the top-level 500 handler).

D4 Head-only: `SchemaInferenceEngine.fromCsv` and `parseCsvRows(maxRows)` read only the first ~101 lines by scanning for newlines instead of `split`.

D5 Concurrency cap: per-instance semaphore (default 2, env `CSV_UPLOAD_MAX_CONCURRENT`) wrapping the two CSV routes OUTSIDE entity unmarshalling so a waiting request never buffers its body; when no permit: 429 with `Retry-After`. Reject, not queue, because queued requests hold connections and the client already has retry affordance. Per-instance, up to 2 instances, so the fleet-wide ceiling is 4; the cap is sized for one instance. Non-CSV multipart types on `POST /api/data-sources` are not counted (permit acquired only once the `type` is known to be CSV is impossible before reading the body; so the permit wraps the whole multipart create route; text/pdf/image uploads are small and short-lived and share it - accepted).

D6 Re-measure after the fixes: N=2 concurrent uploads at the byte cap through infer+create at -Xmx768m, plus N=2 first-run builds at several cell caps; results below and in measurements.md. Rejected-at-cap narrow files reject without OOM.

D7 Frontend: 413 shows "too large / too many rows" copy with no Retry; 429 shows retry-later with Retry. Existing sources over cap in the dev DB are reported read-only.

## Risks

Existing prod sources above caps will start failing at run time with a clear message (previously they would OOM). Row counting treats quoted newlines as rows (conservative). Streaming the run path (HEL-1257) is the way to raise caps.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or commit-gate script is touched.
