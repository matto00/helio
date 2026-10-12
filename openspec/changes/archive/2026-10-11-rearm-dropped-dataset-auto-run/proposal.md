## Why

A dataset write's debounced downstream auto-run (HEL-1093) is silently lost in two cases. If the pipeline already has an active run when the debounce fires, the row is deleted with a DEBUG log. If the HEL-505 guard rejects the submit (rate limit, concurrency cap, or since HEL-1492 the owner budget), the row is deleted with an INFO log. The trailing write is then never materialized until something else triggers a run. helio-news hit this on prod v0.9.3: one of three dependent views showed a stale row until someone re-ran it by hand. HEL-1093's design explicitly accepted both drops as imperfections. The owner has now reversed that (HEL-1504 rulings, 2026-10-11).

## What Changes

- **Active run at fire time (owner ruling Q1: keep pending).** The claim is released *without deleting the row*: `claimed_at` goes back to `NULL` and `fire_at` is unchanged. The first tick after the active run completes fires exactly one run. The one-row-per-pipeline coalescing is unchanged.
- **Guard rejection at fire time (owner ruling Q2: retry after Retry-After, capped at N, then drop with a WARN).** On `ServiceError.TooManyRequests`, the row is re-armed to `fire_at = now + retryAfterSeconds` with an incremented retry counter. Once the counter reaches N, the row is deleted and a WARN is logged that names the pipeline, its owner, the reason and the attempt count. N is set by the new env var `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` (default 10), with the same fallback convention as the other `PIPELINE_RUN_*` rows. A fresh dataset write resets the counter. The guards are never bypassed, and every retry goes through `PipelineRunService.submit`.
- **Migration V125:** adds `guard_retry_count INT NOT NULL DEFAULT 0` to `pipeline_auto_run_debounce`.
- **Unchanged:** fire-time verdict denials (HEL-1384 cost/config) still drop the row. Successful fires and other submit outcomes still compare-and-delete. The writer gets no new signal (owner ruling Q3; HEL-1171/HEL-1172 own denial surfacing).
- **CLAUDE.md:** a new env-table row for `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `dataset-write-auto-run`: an auto-run that finds an active run stays pending until that run completes. A guard-rejected auto-run is retried after Retry-After up to a configured cap, then dropped with a WARN. This replaces the HEL-1097 "no further fire attempt for the SAME denied write" scenario.

## Impact

- Backend: `PipelineAutoRunDebounceFirer`, `PipelineAutoRunDebounceRepository`, `PipelineRunGuardConfig` (new `autoRunMaxRetries`), `PipelineRunService` (`guardConfig` exposed as a val) and `PipelineRunRepository` (shared in-flight query plus a read-only owner count).
- DB: V125 (additive column with a default; no data rewrite).
- Tests: a new red-first repro spec using an embedded Postgres and the clock seam. `AutoRunGuardNoRetryStormSpec` is rewritten to reflect the reversed scenario.
- No API, schema (`schemas/`) or frontend change.
