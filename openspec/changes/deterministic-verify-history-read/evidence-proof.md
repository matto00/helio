# Evidence: red / green proof (tasks 3.1-3.3), constraints C1, C2

Method (design D6): stand-in database S (private, uniquely named, NEVER the shared `helio`), backend A (verify target,
interval 1440, default rate limits = the pre-change setup) and backend B (`OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1`)
both on S, launched by the same launcher (`isolatedRun.backendEnv` + `launchBackend`). B's log timestamps are local
(PDT) `HH:MM:SS.mmm`. No shortened-interval purger ever touched `helio`. Fresh build: `npm run build` in helio-mcp at
09:05:30, `dist/index.js` mtime 09:05:30 (after every change to `src/`; only `scripts/` changed afterwards).

## RED - old setup thinned by a second backend

S = `helio_verify_standin_02a518579e`; A pid 115063; B pid 115169; S user `8dea3300-f310-4126-9e60-49ca5140c6a6`;
S PAT `0bb8436f-32bd-4b85-b0d0-30888cf1647b`. Plain `verify.ts` against A:

    harness window 09:19:38.841 .. 09:21:01.604  exit=1
    B: 09:20:37.899 INFO ... OutputHistoryRetentionService - Output history retention deleted 36 point(s)   (inside window)
    pre-read retained point count (limit 100): 12
    ONE get_output_history call: points=12 sparkline=12 ...
    verify failed: Error: expected 30 points and 30 numeric sparkline values in one call, got points=12 numeric=12 (fewer usually
    means another backend sharing this database ran its retention purge ... rerun with `npm run verify:isolated` ...)

A first red run (09:09:03-09:11:03, S `helio_verify_standin_b72f110fa1`) gave the same: points=12, B deleted 36 at 09:10:03.162.
A harness run against A with raised rate limits finished in 6 s, between B's passes, and passed 30/30 (09:19:07-09:19:13,
no B deletion in window) - kept as `run2-fastharness-nopurge` in the scratchpad: the thinning is timing-dependent, which is
exactly the ticket's intermittency; the slow default-limit harness (~85 s) spans purges.

## GREEN - `verify:isolated` while B purges S

S = `helio_verify_standin_eae76433ac`; A pid 154769; B pid 154994; generator = repeated `verify.ts` runs against A on S
(dense history, each iteration fails thinned as in RED - exit=1 - which shows B active). Attempt 2 (attempt 1 had no B
pass in the harness window; all attempts passed 30/30):

    isolated DB helio_verify_fcd6612e560d, backend JVM pid 166031 port 38221, user eb5bd183-160f-4afb-b049-90ad8b4a2a62,
    bootstrap PAT b612c6cc-706f-4de0-b41e-042a8b1d21ae, harness pid 166238
    D2: v0=2 -> counter=3 -> counter=4 (second tick) before register
    harness window 09:45:50.109 .. 09:45:56.477  exit 0
    B (on S): 09:45:53.728 INFO ... retention deleted 18 point(s)   <- strictly inside the harness window
    pre-read retained point count (limit 100): 30
    ONE get_output_history call: points=30 sparkline=30 compare=previous_run ...
    ISOLATED VERIFY OK (teardown confirmed)

Earlier green runs, same result: 09:11:37-09:13:03 (pre rate-limit change; B deleted 38 at 09:12:15 mid-harness; 30/30),
and attempts 1-6 of two further sessions (all 30/30, exit 0; B passes fell outside the short window, which is why the
driver retried until a pass landed inside it).
