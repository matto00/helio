# HEL-1504: Dataset-write auto-run can be silently dropped (pipeline already running, or rate-limited) and the writer is never told

## Description

Reported by the helio-news session on 2026-10-11, against prod v0.9.3. Details are in that session's hand-over notes (`helio-news-v093-rootcause.md`).

**Symptom:** after a dataset write, the debounced downstream auto-run (HEL-1093, `pipeline_auto_run_debounce`, fired on the scheduler tick) didn't run for one of three dependent views. That view showed a stale row until it was re-run by hand.

**Reported mechanism (verify it):** the debounced fire is skipped when the pipeline is already running, and only logged when the pipeline-run rate limit rejects it (HEL-505). Either way, the debounce row is consumed or dropped and the writer gets no signal. The trailing write's changes are never materialized until something else triggers a run.

**Expected:** a write that lands while a run is in flight, or that is rate-limited, should still lead to one eventual run that includes it. For example, re-arm the debounce instead of dropping it, or mark it pending-after-current-run. Surfacing denials to the writer is related (HEL-1171, HEL-1172).

**Workaround in helio-news:** it now waits up to 45 s after each write and runs any view that didn't refresh.

**To do:** reproduce with a write during an in-flight run and a write at the rate limit. Show the dropped run with a test that fails first, then fix.

## Acceptance Criteria

- A deterministic (clock-seam, no sleeps) reproduction, red first on main, for: (a) a write whose debounce fires while the pipeline's run is in flight; (b) a write whose fire hits the per-user run rate limit; (c) a write whose fire hits the owner concurrency cap. Each shows whether the debounce row is consumed/dropped and whether any later run picks the write up.
- After the fix, each of (a)-(c) leads to exactly one eventual run that includes the write, without bypassing HEL-505 guards and without an unbounded loop or retry storm.
- Behaviour decided by the owner's rulings (recorded below in design.md).
