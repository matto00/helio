# HEL-1691 evidence: why `hel1631-draft-mode.spec.ts:177` is over budget on CI

Status: task group 2 complete. No app code was changed, and no assertion, budget or observer scope was touched (C1). The D5 branch
is chosen by the orchestrator; section 6 states which branch these data select.

Raw data (outside the repo): `/home/matt/Development/helio/.concertino/scratch/HEL-1691/` (`ci/<run>-<attempt>/` holds the job log,
`burst.json` (the `[HEL-1691 json]` line), `json/results.json` and, for failed attempts, `report/` with the Chrome trace;
`local/` holds the local runs and CPU profiles).

## 1. What was measured and how

- D1 (stays after this change): CDP `Performance.getMetrics` deltas around each edit (`ThreadTime`, `TaskDuration`,
  `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`, `V8CompileDuration`), one log line per edit and one
  `[HEL-1691 json]` line per run, before the first `expect`, and the breakdown text appended to the two latency failure messages.
- D2 (diagnosis, `HEL1691_TRACE=1`): Chrome trace of the burst. `console.timeStamp` marks bound exactly the measured interval
  (right before the native setter; in the MutationObserver callback that resolves). Per edit: wall = delta `ts`, thread = delta
  `tts`, GC/style/layout/compile = union of the matching events on the renderer main thread clipped to the interval,
  script/other = thread minus those four. Files: `e2e/support/hel1691Breakdown.ts`, call sites in `e2e/hel1631-draft-mode.spec.ts`.
- The interval is one task: in the failing trace the whole interval is a single `RunTask > Receive mojo message > v8.callFunction >
  EventDispatch` stack (edit 2 of run 39624162187 attempt 2: 91.2 of 91.8 ms inside `EventDispatch`), so it is React's synchronous
  render of the `input` event, not queueing between tasks.
- Leg that runs the spec: read from the logs: `e2e (3)` in every run here (job `e2e (3)`; its `results.json` contains the burst
  test's stdout).
- Local switches (default off, diagnosis only): `HEL1691_THROTTLE=<n>` (CDP CPU throttle), `HEL1691_PROFILE=1` (V8 sampling
  profiler, 100 us), `HEL1691_OUT=<dir>` (where trace/profile files go).

## 2. CI samples (every result, none discarded)

Diagnostic samples on the unchanged budget (draft PR #1084), not retries to green. Rerun with `gh run rerun <run> --job <e2e (3) job>`.

| arm | run | attempt | job | conclusion |
|---|---|---|---|---|
| traced | 39624162187 (sha 05e3753c5) | 1 | 119305079479 | success |
| traced | 39624162187 | 2 | 119317233004 | **failure** (burst test, edits 2-10) |
| traced | 39624162187 | 3 | 119328029883 | success |
| traced | 39624162187 | 4 | 119337001079 | success |
| traced | 39624162187 | 5 | 119346383568 | success |
| traced | 39624162187 | 6 | 119358495986 | success |
| untraced (`HEL1691_TRACE` default off, sha 68bea9e5e) | 39643813340 | 1 | 119373992917 | success |
| untraced | 39643813340 | 2 | 119387273292 | success |
| untraced | 39643813340 | 3 | 119399031857 | success |
| untraced | 39643813340 | 4 | 119410760335 | **failure** (burst test, edit 10) |
| untraced | 39643813340 | 5 | 119422718483 | success |
| untraced | 39643813340 | 6 | 119434268547 | **failure** (burst test, edit 9) |

Totals: 12 samples, 3 failures, 4 over-budget edits among 120. Edit 1 was never over its 100 ms budget (max 79.1 ms).

Distribution (wall ms): traced edit 1 median 49.7 (max 73.7), edits 2-10 median 33.2 / p90 45.3 / max 91.8, per-run max(2-10)
37.0, 91.8, 25.6, 22.9, 41.1, 38.3. Untraced edit 1 median 50.8 (max 79.1), edits 2-10 median 30.5 / p90 42.0 / max 58.4,
per-run max(2-10) 31.8, 28.6, 40.0, 58.4, 37.4, 56.4. Tracing shows no visible observer effect (CI medians 33.2 vs 30.5, a
difference smaller than the run-to-run spread; local dev 4.5 vs 4.8).

CI per-edit work is not a spike on a quiet baseline: the on-CPU time of the same edit differs between runs (traced edits 2-10 thread
time is about 17-25 ms in runs 3 and 4 and about 26-48 ms in runs 1, 2, 5 and 6) and the wall/thread ratio is about 1.0
throughout.

### Over-budget edits, classified by D3 (rule fixed in design.md before the data)

| run | edit | wall | thread | off-CPU share of wall | GC | style+layout+compile in interval | D3 class |
|---|---|---|---|---|---|---|---|
| 39624162187-2 (traced) | 2 | 91.8 | 48.4 (trace `tts`) | 47% (just under the 50% contention line) | 0.0 | 0.0 | app work (script) |
| 39624162187-2 (traced) | 4 | 56.7 | 42.1 (trace `tts`) | 26% | 0.0 | 0.0 | app work (script) |
| 39643813340-4 (untraced) | 10 | 58.4 | 66.4 raw D1; 45.1 after removing the 21.3 ms CI CDP overhead | 0-23% | n/a untraced | style 0.0, layout 1.5, compile 0.0 | app work (script) / CPU-bound |
| 39643813340-6 (untraced) | 9 | 56.4 | 62.8 raw D1; 41.5 adjusted | 0-26% | n/a untraced | style 0.0, layout 1.7, compile 0.0 | app work (script) / CPU-bound |

Tally: app work (script) 4 of 4 (100%); contention 0; GC 0; render/compile 0. (Untraced edits cannot separate GC from script;
the two traced samples show GC at 0.0 ms in every one of the 60 traced edits.) 39624162187-2 edit 2 is the nearest thing to a
contention case: 43 of 92 ms off-CPU, but 47% is below the 50% line, and its neighbours (edit 1: 73.7 wall / 64.4 thread, edit 3:
45.6 / 42.4) are on-CPU.

Overhead of D1's own calls: D1 `ThreadTime` minus the trace's `tts` is a median 21.3 ms per edit on CI (range 12.1-33.9, 60 edits)
and 7.9 ms locally (dev server, 1x, 50 edits). Raw D1 thread time is therefore always at or above wall in the untraced arm; the
adjusted column above subtracts the CI median. The trace's `tts` (no CDP calls inside the interval) is the authoritative signal.

## 3. Per-edit tables

#### 39624162187-1 (traced, job 119305079479, success)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 72.9 | 68.4 | 0.0 | 0.1 | 5.2 | 0.0 | 63.2 | 95.3 | 78.1 |  |
| 2 | 29.7 | 29.7 | 0.0 | 0.0 | 0.0 | 0.0 | 29.7 | 57.3 | 38.3 |  |
| 3 | 37.0 | 36.9 | 0.0 | 0.0 | 0.0 | 0.0 | 36.9 | 59.1 | 43.7 |  |
| 4 | 28.8 | 28.7 | 0.0 | 0.0 | 0.0 | 0.0 | 28.7 | 48.4 | 34.4 |  |
| 5 | 31.7 | 31.5 | 0.0 | 0.0 | 0.0 | 0.0 | 31.5 | 50.5 | 36.3 |  |
| 6 | 35.3 | 35.2 | 0.0 | 0.0 | 0.0 | 0.0 | 35.2 | 60.7 | 40.5 |  |
| 7 | 33.8 | 33.8 | 0.0 | 0.0 | 0.0 | 0.0 | 33.8 | 52.8 | 39.3 |  |
| 8 | 35.2 | 35.2 | 0.0 | 0.0 | 0.0 | 0.0 | 35.2 | 54.3 | 40.3 |  |
| 9 | 32.5 | 32.5 | 0.0 | 0.0 | 0.0 | 0.0 | 32.5 | 55.7 | 36.7 |  |
| 10 | 26.4 | 26.4 | 0.0 | 0.0 | 0.0 | 0.0 | 26.4 | 42.6 | 29.6 |  |

#### 39624162187-2 (traced, job 119317233004, failure)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 73.7 | 64.4 | 0.0 | 0.1 | 5.1 | 0.0 | 59.3 | 97.6 | 77.9 |  |
| 2 | 91.8 **OVER** | 48.4 | 0.0 | 0.0 | 0.0 | 0.0 | 48.4 | 73.8 | 104.7 | CPU-bound, script (53% of wall on-CPU) |
| 3 | 45.3 | 42.4 | 0.0 | 0.0 | 0.0 | 0.0 | 42.4 | 72.2 | 57.7 |  |
| 4 | 56.7 **OVER** | 42.1 | 0.0 | 0.0 | 0.0 | 0.0 | 42.1 | 66.9 | 73.9 | CPU-bound, script (74% of wall on-CPU) |
| 5 | 42.7 | 40.5 | 0.0 | 0.0 | 0.0 | 0.0 | 40.5 | 63.4 | 48.6 |  |
| 6 | 44.3 | 39.2 | 0.0 | 0.0 | 0.0 | 0.0 | 39.2 | 61.8 | 50.3 |  |
| 7 | 46.2 | 36.4 | 0.0 | 0.0 | 0.0 | 0.0 | 36.4 | 62.0 | 51.0 |  |
| 8 | 49.0 | 39.5 | 0.0 | 0.0 | 0.0 | 0.0 | 39.5 | 62.5 | 61.0 |  |
| 9 | 49.7 | 40.0 | 0.0 | 0.0 | 0.0 | 0.0 | 40.0 | 61.3 | 56.8 |  |
| 10 | 41.6 | 35.3 | 0.0 | 0.0 | 0.0 | 0.0 | 35.3 | 56.2 | 45.2 |  |

#### 39624162187-3 (traced, job 119328029883, success)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 31.9 | 31.3 | 0.0 | 0.0 | 2.7 | 0.0 | 28.5 | 50.4 | 33.5 |  |
| 2 | 25.0 | 24.5 | 0.0 | 0.0 | 0.0 | 0.0 | 24.5 | 43.9 | 29.4 |  |
| 3 | 22.2 | 21.1 | 0.0 | 0.0 | 0.0 | 0.0 | 21.1 | 37.5 | 26.0 |  |
| 4 | 22.0 | 21.9 | 0.0 | 0.0 | 0.0 | 0.0 | 21.9 | 36.4 | 25.7 |  |
| 5 | 22.7 | 22.8 | 0.0 | 0.0 | 0.0 | 0.0 | 22.8 | 37.7 | 25.8 |  |
| 6 | 19.3 | 19.3 | 0.0 | 0.0 | 0.0 | 0.0 | 19.3 | 38.5 | 22.7 |  |
| 7 | 16.9 | 16.9 | 0.0 | 0.0 | 0.0 | 0.0 | 16.9 | 29.0 | 19.6 |  |
| 8 | 16.5 | 16.5 | 0.0 | 0.0 | 0.0 | 0.0 | 16.5 | 30.5 | 18.6 |  |
| 9 | 18.7 | 19.8 | 0.0 | 0.0 | 0.0 | 0.0 | 19.8 | 32.3 | 21.1 |  |
| 10 | 25.6 | 21.1 | 0.0 | 0.0 | 0.0 | 0.0 | 21.1 | 38.2 | 30.0 |  |

#### 39624162187-4 (traced, job 119337001079, success)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 37.0 | 36.6 | 0.0 | 0.0 | 3.1 | 0.0 | 33.4 | 58.0 | 39.0 |  |
| 2 | 22.7 | 22.5 | 0.0 | 0.0 | 0.0 | 0.0 | 22.5 | 44.6 | 27.9 |  |
| 3 | 21.7 | 21.5 | 0.0 | 0.0 | 0.0 | 0.0 | 21.5 | 38.2 | 25.6 |  |
| 4 | 21.6 | 21.4 | 0.0 | 0.0 | 0.0 | 0.0 | 21.4 | 37.9 | 25.3 |  |
| 5 | 22.9 | 22.9 | 0.0 | 0.0 | 0.0 | 0.0 | 22.9 | 39.6 | 26.6 |  |
| 6 | 21.6 | 21.6 | 0.0 | 0.0 | 0.0 | 0.0 | 21.6 | 43.2 | 25.2 |  |
| 7 | 19.9 | 19.9 | 0.0 | 0.0 | 0.0 | 0.0 | 19.9 | 34.5 | 22.9 |  |
| 8 | 18.8 | 18.8 | 0.0 | 0.0 | 0.0 | 0.0 | 18.8 | 31.7 | 21.3 |  |
| 9 | 20.5 | 20.5 | 0.0 | 0.0 | 0.0 | 0.0 | 20.5 | 35.1 | 23.6 |  |
| 10 | 22.2 | 21.0 | 0.0 | 0.0 | 0.0 | 0.0 | 21.0 | 37.9 | 24.1 |  |

#### 39624162187-5 (traced, job 119346383568, success)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 44.1 | 43.5 | 0.0 | 0.0 | 3.3 | 0.0 | 40.1 | 66.1 | 46.5 |  |
| 2 | 32.1 | 32.0 | 0.0 | 0.0 | 0.0 | 0.0 | 32.0 | 53.4 | 38.8 |  |
| 3 | 37.7 | 37.6 | 0.0 | 0.0 | 0.0 | 0.0 | 37.6 | 63.6 | 44.4 |  |
| 4 | 39.4 | 37.4 | 0.0 | 0.0 | 0.0 | 0.0 | 37.4 | 56.7 | 43.7 |  |
| 5 | 37.7 | 37.7 | 0.0 | 0.0 | 0.0 | 0.0 | 37.7 | 58.3 | 42.3 |  |
| 6 | 40.3 | 40.1 | 0.0 | 0.0 | 0.0 | 0.0 | 40.1 | 69.1 | 45.2 |  |
| 7 | 33.6 | 33.5 | 0.0 | 0.0 | 0.0 | 0.0 | 33.5 | 52.8 | 38.8 |  |
| 8 | 33.0 | 32.0 | 0.0 | 0.0 | 0.0 | 0.0 | 32.0 | 49.7 | 37.4 |  |
| 9 | 41.1 | 39.4 | 0.0 | 0.0 | 0.0 | 0.0 | 39.4 | 59.2 | 45.5 |  |
| 10 | 33.4 | 33.2 | 0.0 | 0.0 | 0.0 | 0.0 | 33.2 | 58.5 | 38.1 |  |

#### 39624162187-6 (traced, job 119358495986, success)

| edit | wall | trace thread | GC | style | layout | compile | script/other | D1 thread | D1 script | class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 55.3 | 54.3 | 0.0 | 0.0 | 5.1 | 0.0 | 49.2 | 78.3 | 56.7 |  |
| 2 | 34.0 | 34.0 | 0.0 | 0.0 | 0.0 | 0.0 | 34.0 | 58.6 | 42.5 |  |
| 3 | 33.5 | 33.5 | 0.0 | 0.0 | 0.0 | 0.0 | 33.5 | 60.4 | 40.6 |  |
| 4 | 35.8 | 35.6 | 0.0 | 0.0 | 0.0 | 0.0 | 35.6 | 57.8 | 42.4 |  |
| 5 | 37.4 | 37.4 | 0.0 | 0.0 | 0.0 | 0.0 | 37.4 | 58.8 | 42.5 |  |
| 6 | 29.8 | 29.7 | 0.0 | 0.0 | 0.0 | 0.0 | 29.7 | 63.6 | 36.1 |  |
| 7 | 30.3 | 30.3 | 0.0 | 0.0 | 0.0 | 0.0 | 30.3 | 48.7 | 34.9 |  |
| 8 | 34.0 | 33.9 | 0.0 | 0.0 | 0.0 | 0.0 | 33.9 | 55.9 | 38.5 |  |
| 9 | 33.6 | 33.4 | 0.0 | 0.0 | 0.0 | 0.0 | 33.4 | 54.8 | 37.9 |  |
| 10 | 38.3 | 34.6 | 0.0 | 0.0 | 0.0 | 0.0 | 34.6 | 58.1 | 39.6 |  |

#### 39643813340-1 (untraced, job 119373992917, success)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 33.7 | 48.5 | 27.2 | 48.0 | 35.1 | 2.6 | 0.0 | 0.0 |  |
| 2 | 20.5 | 37.8 | 16.5 | 42.6 | 25.1 | 1.3 | 0.0 | 0.0 |  |
| 3 | 18.8 | 31.8 | 10.5 | 31.4 | 22.3 | 1.4 | 0.0 | 0.0 |  |
| 4 | 22.8 | 37.7 | 16.4 | 43.0 | 29.5 | 1.3 | 0.0 | 0.0 |  |
| 5 | 31.8 | 43.9 | 22.6 | 55.7 | 37.7 | 2.0 | 0.0 | 0.0 |  |
| 6 | 15.5 | 25.2 | 3.9 | 24.8 | 17.8 | 1.0 | 0.0 | 0.0 |  |
| 7 | 17.4 | 29.1 | 7.8 | 28.7 | 20.2 | 1.1 | 0.0 | 0.0 |  |
| 8 | 21.2 | 33.8 | 12.5 | 36.8 | 24.9 | 1.1 | 0.0 | 0.0 |  |
| 9 | 22.0 | 37.4 | 16.1 | 37.2 | 24.2 | 1.1 | 0.0 | 0.0 |  |
| 10 | 14.3 | 23.0 | 1.7 | 22.5 | 14.9 | 1.0 | 0.0 | 0.0 |  |

#### 39643813340-2 (untraced, job 119387273292, success)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 40.2 | 61.5 | 40.2 | 61.0 | 43.7 | 3.6 | 0.0 | 0.0 |  |
| 2 | 28.6 | 53.5 | 32.2 | 52.5 | 35.6 | 1.7 | 0.0 | 0.0 |  |
| 3 | 25.4 | 40.9 | 19.6 | 39.9 | 30.0 | 1.2 | 0.0 | 0.0 |  |
| 4 | 27.4 | 43.4 | 22.1 | 42.2 | 32.2 | 1.5 | 0.0 | 0.0 |  |
| 5 | 24.4 | 40.1 | 18.8 | 39.1 | 29.1 | 1.4 | 0.0 | 0.0 |  |
| 6 | 24.4 | 42.8 | 21.5 | 41.5 | 28.2 | 1.1 | 0.0 | 0.0 |  |
| 7 | 22.9 | 36.5 | 15.2 | 35.5 | 26.7 | 1.0 | 0.0 | 0.0 |  |
| 8 | 24.7 | 41.2 | 19.9 | 40.1 | 28.9 | 1.4 | 0.0 | 0.0 |  |
| 9 | 23.3 | 41.7 | 20.4 | 41.4 | 26.3 | 1.3 | 0.0 | 0.0 |  |
| 10 | 20.8 | 34.4 | 13.1 | 33.3 | 22.1 | 1.0 | 0.0 | 0.0 |  |

#### 39643813340-3 (untraced, job 119399031857, success)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 61.0 | 82.8 | 61.5 | 94.7 | 68.8 | 4.1 | 0.0 | 0.0 |  |
| 2 | 36.1 | 63.5 | 42.2 | 65.1 | 44.1 | 1.9 | 0.1 | 0.0 |  |
| 3 | 40.0 | 60.6 | 39.3 | 59.5 | 45.1 | 1.2 | 0.0 | 0.0 |  |
| 4 | 36.1 | 56.2 | 34.9 | 55.2 | 42.2 | 1.3 | 0.0 | 0.0 |  |
| 5 | 30.5 | 51.2 | 29.9 | 52.5 | 36.2 | 1.5 | 0.0 | 0.0 |  |
| 6 | 31.8 | 54.4 | 33.1 | 53.7 | 36.9 | 1.1 | 0.0 | 0.0 |  |
| 7 | 32.9 | 52.8 | 31.5 | 53.1 | 39.0 | 1.0 | 0.0 | 0.0 |  |
| 8 | 31.8 | 50.6 | 29.3 | 49.3 | 36.1 | 1.0 | 0.0 | 0.0 |  |
| 9 | 27.7 | 45.9 | 24.6 | 46.5 | 31.2 | 1.1 | 0.0 | 0.0 |  |
| 10 | 28.0 | 45.1 | 23.8 | 44.3 | 29.4 | 1.1 | 0.0 | 0.0 |  |

#### 39643813340-4 (untraced, job 119410760335, failure)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 47.9 | 73.1 | 51.8 | 73.8 | 52.4 | 3.4 | 0.0 | 0.0 |  |
| 2 | 35.4 | 56.6 | 35.3 | 55.8 | 41.7 | 2.0 | 0.0 | 0.0 |  |
| 3 | 33.6 | 58.6 | 37.3 | 58.1 | 39.8 | 1.2 | 0.0 | 0.0 |  |
| 4 | 29.4 | 52.2 | 30.9 | 54.5 | 38.4 | 1.1 | 0.0 | 0.0 |  |
| 5 | 31.7 | 54.3 | 33.0 | 54.8 | 39.6 | 1.9 | 0.0 | 0.0 |  |
| 6 | 42.0 | 63.2 | 41.9 | 69.6 | 47.7 | 2.7 | 0.0 | 0.0 |  |
| 7 | 30.0 | 46.9 | 25.6 | 45.8 | 33.9 | 1.1 | 0.0 | 0.0 |  |
| 8 | 30.0 | 50.3 | 29.0 | 49.6 | 34.7 | 1.5 | 0.0 | 0.0 |  |
| 9 | 33.3 | 52.1 | 30.8 | 55.9 | 38.1 | 1.2 | 0.0 | 0.0 |  |
| 10 | 58.4 **OVER** | 66.4 | 45.1 | 87.1 | 59.4 | 1.5 | 0.0 | 0.0 | CPU-bound, script (77% of wall on-CPU, adjusted) |

#### 39643813340-5 (untraced, job 119422718483, success)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 53.8 | 79.7 | 58.4 | 79.3 | 59.0 | 3.3 | 0.0 | 0.0 |  |
| 2 | 37.4 | 61.5 | 40.2 | 63.0 | 44.4 | 1.9 | 0.0 | 0.0 |  |
| 3 | 34.4 | 58.3 | 37.0 | 57.1 | 41.8 | 1.9 | 0.0 | 0.0 |  |
| 4 | 30.5 | 50.4 | 29.1 | 49.4 | 35.4 | 1.5 | 0.0 | 0.0 |  |
| 5 | 31.4 | 53.1 | 31.8 | 52.4 | 37.1 | 1.2 | 0.0 | 0.0 |  |
| 6 | 31.9 | 52.0 | 30.7 | 53.3 | 36.3 | 1.1 | 0.0 | 0.0 |  |
| 7 | 32.1 | 50.2 | 28.9 | 49.0 | 36.3 | 1.1 | 0.0 | 0.0 |  |
| 8 | 31.6 | 50.5 | 29.2 | 49.4 | 35.6 | 1.5 | 0.0 | 0.0 |  |
| 9 | 26.2 | 47.7 | 26.4 | 48.8 | 30.0 | 1.5 | 0.0 | 0.0 |  |
| 10 | 33.9 | 54.5 | 33.2 | 53.9 | 38.2 | 1.7 | 0.0 | 0.0 |  |

#### 39643813340-6 (untraced, job 119434268547, failure)

| edit | wall | D1 thread (raw) | D1 thread minus 21.3 ms CDP overhead | D1 task | D1 script | D1 layout | D1 style | D1 compile | class |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 79.1 | 101.4 | 80.1 | 116.9 | 86.4 | 8.8 | 0.0 | 0.0 |  |
| 2 | 48.6 | 75.1 | 53.8 | 98.3 | 62.3 | 2.6 | 0.0 | 0.0 |  |
| 3 | 31.5 | 52.0 | 30.7 | 50.9 | 37.0 | 1.9 | 0.0 | 0.0 |  |
| 4 | 33.0 | 51.9 | 30.6 | 50.9 | 38.9 | 1.6 | 0.0 | 0.0 |  |
| 5 | 29.2 | 47.4 | 26.1 | 47.7 | 34.2 | 2.6 | 0.0 | 0.0 |  |
| 6 | 29.5 | 51.9 | 30.6 | 51.2 | 34.0 | 1.6 | 0.0 | 0.0 |  |
| 7 | 28.3 | 47.1 | 25.8 | 45.8 | 32.7 | 1.6 | 0.0 | 0.0 |  |
| 8 | 47.5 | 65.2 | 43.9 | 70.2 | 53.5 | 1.0 | 0.0 | 0.0 |  |
| 9 | 56.4 **OVER** | 62.8 | 41.5 | 80.8 | 61.0 | 1.7 | 0.0 | 0.0 | CPU-bound, script (74% of wall on-CPU, adjusted) |
| 10 | 49.6 | 62.5 | 41.2 | 83.0 | 52.0 | 1.1 | 0.0 | 0.0 |  |

## 4. Local baseline

#### Local summary (this machine, one worker; wall ms; median of per-run values)

| config | runs | edit 1 med (range) | edits 2-10 med | per-run max(2-10) | D1 thread med (2-10) | trace thread med (2-10) |
|---|---|---|---|---|---|---|
| dev-t0-x1 | 5 | 12.7 (10.1-22.8) | 4.8 | 15.0 4.8 6.0 5.3 10.7 | 12.6 | - |
| dev-t1-x1 | 5 | 21.2 (12.5-23.3) | 4.5 | 10.9 11.1 5.0 5.9 5.5 | 12.3 | 4.5 |
| dev-t0-x6 | 5 | 136.1 (72.2-148.7) | 88.5 | 95.9 96.3 96.7 96.6 95.7 | 146.7 | - |
| dev-t1-x6 | 5 | 148.6 (81.7-188.2) | 91.2 | 96.5 128.2 109.5 93.7 94.6 | 155.2 | 91.2 |
| prod-t0-x1 | 5 | 6.5 (6.1-6.5) | 2.0 | 2.6 2.6 2.6 3.0 2.5 | 8.2 | - |
| prod-t1-x1 | 5 | 6.9 (6.6-7.5) | 2.1 | 2.2 2.7 2.7 2.5 2.5 | 8.4 | 2.0 |
| prod-t0-x6 | 3 | 48.2 (43.0-50.0) | 12.8 | 15.8 16.5 14.8 | 56.7 | - |
| prod-t1-x6 | 3 | 49.4 (43.9-58.9) | 13.6 | 16.2 17.8 22.7 | 60.8 | 13.6 |

Local runs: `nice -n 19`, one worker, under `flock`, `--trace retain-on-failure`; dev = `scripts/concertino/start-servers.sh`
(Vite dev server, React development build, StrictMode); prod = `npx vite build && npx vite preview --port 7123 --strictPort`
from `frontend/` (fresh Playwright browser context per test, so no service worker carry-over). `t0`/`t1` = tracing off/on,
`x1`/`x6` = unthrottled / CDP 6x CPU throttle. Local D1 overhead (D1 thread minus trace `tts`): median 7.9 ms (dev, x1).

Findings:

- Dev vs prod, unthrottled: steady edits 4.5-4.8 ms (dev) vs 2.0-2.1 ms (prod), about 2.3x; edit 1 12.7-21.2 ms vs 6.5-6.9 ms.
  Under 6x throttle: steady 88-91 ms (dev) vs 12.8-13.6 ms (prod), about 7x; edit 1 136-149 ms vs 48-49 ms. The production
  build meets the unchanged budget (edit 1 < 100, edits 2-10 < 50) under 6x throttle in all 6 runs; the dev build fails it in all 10.
- Tracing does not perturb the local numbers visibly (dev x1 steady 4.5 traced vs 4.8 untraced; prod 2.1 vs 2.0).
- The 6x throttle is not a model of the CI runner: it slows the renderer only, and the dev build at 6x (about 90 ms) is far
  slower than CI (about 30 ms). CI is roughly 6.5x the local unthrottled dev cost per edit (30.5 vs 4.5-4.8).
- Local dev edit 1 is the cold first edit (10-23 ms, lazy compile), CI edit 1 is 32-79 ms.

## 5. Where the script time goes (local V8 sampling profile, dev server, 100 us interval, 2 runs)

Playwright's own DOM snapshotter (`captureSnapshot`, from `trace: "retain-on-failure"` in `playwright.config.ts`) runs in the page
between actions (13-22 ms per snapshot locally); those samples are excluded below and it does not run inside the measured
interval (the interval is one task).

Self time by file, sampled burst (excluding the snapshotter): 55% and 62% of self time is in `react-dom_client.js`,
`react_jsx-dev-runtime.js` and `react.js` (development builds); the helio modules in the top files
(`evaluatePipeline.ts`, `pipelineDraft.ts`, `usePipelineDraftFrames.ts`, `SpineStepRow.tsx`, `StepPreviewTable.tsx`, `DataGrid.tsx`,
`useScrollEdges.ts`, `describeSampleLabel.ts`) are 11% and 8%. Hottest functions (self ms of 69.9 / 90.1 total): `jsxDEV` 15.0 (run 2),
`ReactElement` 5.0 / 3.7, `addObjectDiffToProperties` 2.8 / 2.5, `updateProperties` 2.6 / 1.6, `validateProperty` 1.6 / 1.4,
`validatePropertiesInDevelopment` 1.1, `createTask` 1.4, `defineKeyPropWarningGetter` 0.9, `(garbage collector)` 3.1 / 4.1; the
evaluator walk (`evaluatePipeline.ts`) is about 1 ms. These dev-only functions (JSX element validation, owner/debug-task bookkeeping,
property diffing for warnings) do not exist in the production build. The hot functions on the CI runner itself were not
captured: the D2 trace categories carry no JS sampling, so on CI the interval is known only as `EventDispatch` script time.

## 6. D5 branch these data select

1. Contention (wall much greater than thread): **rejected.** In 12 CI samples the median wall/thread ratio is 1.00 (traced) and
   1.08 (untraced, raw D1 corrected by the overhead), and the only edit near the contention line (39624162187-2 edit 2, 47%
   off-CPU) is a single edit whose neighbours are on-CPU.
2. GC: rejected (0.0 ms in the interval in every one of the 60 traced edits; the local profile shows GC at 3-4 ms of 70-90 ms).
3. Render/compile: rejected (style 0.0, layout 0.0-5.5 ms and compile 0.0 in the interval).
4. D3 literally classifies all 4 over-budget edits as **app work (script)** (100%, above the 80% single-class threshold), and
   the D3 dev-build check then applies: the script is mostly React's development runtime (section 5), and the same edits cost
   2.3x less in a production build locally (7x less under 6x throttle, where the production build passes the unchanged budget).
   Therefore the selected branch is **dev-build-only cost**: the cost that pushes edits over budget is mostly not shipped to
   users, so a fix would mean changing what CI measures (production build, or no StrictMode/dev checks), an owner decision
   under C1. A production-relevant remainder exists (about 2 ms per edit unthrottled, 12-14 ms at 6x on this machine) but it is
   far below the 50 ms budget and no profile points at helio code (8-11%).

Caveats the orchestrator should weigh before escalating:

- CI is CPU-bound with a wall/thread ratio of about 1, but the on-CPU time of the same edit differs by up to 2.5x between runs
  (about 17-25 ms vs 26-48 ms). Thread time counts a slow CPU (shared cores, SMT sibling, frequency, cache pressure) as
  "on-CPU", so D3 cannot separate "the code did more work" from "the runner ran the same work slower". The data do not show a
  larger edit workload in the slow runs (same DOM, no extra requests, GC zero), but they do not prove a slow runner either.
  A decisive extra probe, not run here because it adds a CI sampling cycle: time a fixed pure-JS calibration loop in the page
  immediately before each edit and log it next to the edit.
- The profile is local only, on the dev server, with Playwright's snapshotter excluded; no JS-level profile exists from CI.
- Only 4 over-budget edits exist in 120 CI edits; the per-class tally rests on a small number, though they all agree.
- The ticket's own failing runs (117.8 ms edit 1, five consecutive slow edits at 62-85 ms) did not reproduce in these 12 samples;
  untraced run 39643813340-6 had a sustained slow period (edits 1-2 and 8-10 at 47-79 ms while edits 3-7 were 28-33 ms).

## 7. What was not done in this cycle

No app code was changed. Candidate changes the orchestrator may weigh under the chosen branch (not implemented): run the burst
test against the production build (`vite build` + `vite preview`) in CI, or keep the dev build and use a robust statistic or a
dev-build budget; both change what is measured and need an owner ruling (C1). The D2 trace stays behind the default-off
`HEL1691_TRACE` switch for now (task 3.2 decides whether it is removed).

## 8. Prod-build harness verification (owner ruling `prod-build-measurement`, D7-D11)

The burst test is cited by its title ("a burst of client-evaluable edits sends no request ..."), at line 183 on this branch.
`BURST_TITLE` holds the title so the assertion block keeps main's indentation: the `toBeLessThan(100)` and `toBeLessThan(50)`
lines are byte-identical to main (`diff` of the two lines: empty). Because C1 forbids touching the assertion lines, the D1
breakdown is logged before the first `expect` (stdout of the job and `results.json`), not appended to the assertion messages.

Guard (D8), run with `HELIO_E2E_PROD_BUILD=1`:

- RED against the Vite dev server (lane stack on 7123/10030): `1 failed` (`prod-build-guard` ... `/ must not load the Vite dev client`),
  `1 did not run` (the burst test, skipped as a dependency failure).
- GREEN against `vite preview` (`npm run e2e:prod-build`, DEV_PORT 7126, log `local/prodbuild-run2.log`): `2 passed`, guard 28 ms;
  burst edits 6.0, 2.5, 2.0, 2.0, 1.4, 1.6, 1.5, 1.6, 1.4, 2.3 ms. The script stopped its own preview (port refused afterwards);
  the lane stack was stopped with `scripts/concertino/stop-servers.sh` and ports 7123, 7126 and 10030 were confirmed free.
- A first `e2e:prod-build` attempt on a port whose backend CORS origin did not match failed at login (`page.waitForURL` timeout, unrelated to the
  harness); the backend must be started for the same `DEV_PORT`.

Partition check (D8b), `npm run check:e2e-prod-build-projects`, on the real `--list` output (tags appear without `@`):

- GREEN as committed (env unset -> only `dev`, none tagged; env set -> guard + tagged `prod-build`).
- RED, tag removed from the burst test: `env set: no test is listed in project prod-build (only the guard, or nothing)`.
- RED, `prod-build` project `grep` widened: `env set: untagged test would run in prod-build: hel1583-home-375.spec.ts ...` (many).
- RED, `dev` project `grepInvert` removed: `env unset: @prod-build test would run on the dev server: hel1631-draft-mode.spec.ts ...`.
- Selftest (`:selftest`): 11 cases, including the guard-only fixture (red) and the clean ones.

Other checks: `check:e2e-shard:selftest` (15 cases), `check:ci-complete-needs` (6 jobs incl. `e2e-prod-build`) and its selftest, lint,
prettier, `check:e2e-types`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup` all exit 0. The shard plan is unchanged
(`--project=dev` on `--list`, the re-list and the run). `e2e/shard-weights.tsv` has no row for hel1631 (it is "defaulted", 43 s), so nothing is over-weighted and nothing needs regenerating for this change (it was already
defaulted); not regenerated here.

## 9. D9 CI cost measurements (PR #1084, draft)

Runs of the PR head: 39677346014 (`6a859ce42`, first run with the harness) and 39681692001 (`af45c9bc5`, the final push: the only
change since is `e2e-prod-build` `timeout-minutes` 20 -> 8). Raw data: `.concertino/scratch/HEL-1691/d9/`.

**Baseline fallback (note 3):** fewer than 5 main runs share this PR's spec set. Every main run in the last two days differs
from `4f729eed7` (the PR's base) by added or removed `e2e/*.spec.ts` files (diff of spec files plus `shard-weights.tsv`:
0 lines for `4f729eed7` itself, 2 for `77f46a5df`, 2 for `edd3a028f`, 3 for `e88acadb9`, 4 for `edfd329c8`, 9+ for older runs), so only ONE
main run (39619844110, `4f729eed7`) has the identical spec set and weights. Fallback used: the last 5 main runs
(39619844110, 39615405498, 39583908105, 39560107292, 39542663790), per-leg median, noting that their partitions differ slightly.
Numbers are summed test durations from each leg's `results.json` (two workers, so about twice the work-time of the wall time), in seconds.

| leg | main 4f729eed7 | main 77f46a5df | main edd3a028f | main e88acadb9 | main edfd329c8 | **median of 5** | PR run 1 | PR run 2 (final) |
|---|---|---|---|---|---|---|---|---|
| 1 | 1694 | 2009 | 1709 | 1618 | 1997 | **1709** | 1760 (+51) | 2075 (+366) |
| 2 | 2380 | 2408 | 2504 | 1808 | 2541 | **2408** | 2503 (+95) | 2361 (-47) |
| 3 | 2295 | 2169 | 2237 | 1924 | 2198 | **2198** | 2328 (+130) | 2277 (+79) |
| 4 | 1823 | 2506 | 2454 | 1952 | 2079 | **2079** | 2557 (+478) | no report: the leg hit its 25 min `timeout-minutes` with 179 of 182 tests done |
| total | 8192 | 9091 | 8905 | 7301 | 8814 | **8814** | 9148 (+334) | n/a |

Wall time of the `e2e (n)` jobs (s): main 4f729eed7 1006/1394/1353/1068; the five mains span 952-1230 (leg 1), 1064-1498 (leg 2),
1123-1353 (leg 3), 1068-1460 (leg 4); PR run 1 1041/1480/1371/1491; PR run 2 1237/1376/1350/1518 (cancelled at the 25 min limit).

1. **Per-leg test time vs the median: the D9 threshold (+60 s) is exceeded** on PR run 1 in legs 2 (+95), 3 (+130), 4 (+478), and on the
   final run in legs 1 (+366) and 3 (+79). What the data say about cause: the change adds nothing to any shard leg (no step added; the
   only dev test removed is the burst test, in leg 3, about 10 s) and legs 1, 2 and 4 contain no changed test. The same legs vary
   by hundreds of seconds between main runs (leg 4: 1823-2506; leg 1: 1618-2009) and between the PR's two runs (leg 1: 1760 vs 2075). A single
   PR sample cannot be separated from that spread; against the one identical-spec-set main run the legs are +66/+123/+33/+734.
   Per C2 this is reported as an escalation rather than judged away; no timeout was raised.
2. **`e2e-prod-build` job:** queued-to-started 2 s (run 1) and 1 s (run 2); duration 196 s (3 m 16 s, run 1) and 227 s (3 m 47 s, run 2);
   2 tests passed (guard + burst). Timeout tightened to 8 min (about 2x).
3. **`ci-complete` vs the slowest leg:** it finished 20 s after the slowest `e2e` leg in run 1 (21:41:05 vs 21:40:45; the same gap as
   its own startup) and 6 s after in run 2 (22:13:40 vs 22:13:34); `e2e-prod-build` finished 21 and 22 minutes earlier, so it did not delay `ci-complete`.

Final-run failure: `e2e (4)` was cancelled by its existing 25-minute job limit (`The operation was canceled`) with 3 of 182 tests
not yet run (it was inside `state-surface-contrast-guard.spec.ts`, 9-11 s per test); no test failed. This is the HEL-1667 condition (legs at
24-25 min against a 25 min limit), independent of the harness: leg 4's 23 spec files are unchanged by this PR. It still turns `ci-complete` red on this PR.
