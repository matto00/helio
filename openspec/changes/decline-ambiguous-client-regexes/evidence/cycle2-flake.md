# Cycle 2: the probe's server outcome depended on timing

Failure (orchestrator's full e2e run): `getByLabel("Preview is live")` not visible; the probe step showed the server error
"... exceeded the 2 s regex time budget for this step".

Root cause (confirmed by probe, Scala engine via `POST /api/pipelines/:id/run`, quiet machine, `^(.*.*.*.*.*.*.*.*x)` on "a"x28+"!"):
5 rows: 1.571 s, 1.586 s, 1.576 s; 1 row: 0.370 s. The engine needs ~0.37 s per cell, so five cells sit at 79% of the 2 s per-step
budget and parallel load pushes it over. Not a client defect.

Fix: the probe uses 2 rows (~0.75 s server, >2.5x margin). The base tree still produces a long task: re-proved red on the
base-tree javaRegex.ts with 2 rows: probe longest task 494.0 ms ("longest main-thread task was 494.0 ms, must be <= 100 ms (control 0.0 ms)").
Control now uses a saved pattern `(x)` (empty out) and edits to `(a+)!`, asserting the client-computed out cell "a"x28 with no request.
Green: 3 sequential runs passed (11.7 s each); `--repeat-each=3 --workers=2`: 3 passed (23.7 s); every longest task 0.0 ms.
