## Standing Constraints

- [C1] Red first: the new repro spec's (a)/(b)/(c) cases are run against unmodified main code and fail, with the red transcript saved before any production change.
- [C2] New DB specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` must appear in sbt runs; deterministic clock seam, no sleeps; no inline FQNs.
- [C3] Never bypass HEL-505 guards; every retry goes through `PipelineRunService.submit`; no unbounded loop.

## 1. Repro (red first)

- [x] 1.1 Add `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunDroppedFireSpec.scala` covering design.md D6 cases (a) in-flight run, (b) per-user rate limit, (c) owner concurrency cap; assert on `pipeline_auto_run_debounce` / `pipeline_runs` / `pipeline_run_rate_window` rows only; fixture rule per design.md D6 (status='running' + completed_at NULL; complete via updateRunTerminal*)
- [x] 1.2 Run it against unmodified production code; save the red transcript as `.concertino/runs/HEL-1504/evidence/red-repro.txt` (main checkout) and confirm each of (a)/(b)/(c) fails for the dropped-row reason

## 2. Schema + config

- [x] 2.1 Re-check the next free Flyway number on origin/main; add `V125__auto_run_debounce_guard_retry_count.sql` (`guard_retry_count INT NOT NULL DEFAULT 0`)
- [x] 2.2 Add `autoRunMaxRetries` (default 10, env `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES`, non-numeric or < 0 → default) to `PipelineRunGuardConfig`; the firer reads it from `PipelineRunService.guardConfig` (now a public val), the same instance the guard enforces
- [x] 2.3 Add the CLAUDE.md env-table row for `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` (state exactly: default 10; non-numeric or < 0 falls back to 10; 0 = never retry, drop with WARN; retries spaced max(Retry-After, tick); cap-blocked retries do not consume rate slots; see HEL-1504); run `node scripts/check-schema-drift` / any env-doc parity check that exists

## 3. Fix

- [x] 3.1 `PipelineAutoRunDebounceRepository`: `unclaim` (D1), `rearmAfterGuardRejection` returning Rearmed/Exhausted/Superseded (D2), and `upsertDebounce` resets `guard_retry_count = 0` (D3); repository spec coverage for each including token-mismatch
- [x] 3.1b `PipelineRunRepository.countOwnerInFlightRealRunsInternal(ownerId)` under `withSystemContext`, reusing/extracting (shared query, not a copy — evaluator verifies by reading) the exact predicate `insertRunIfUnderConcurrencyCap` counts (D2a)
- [x] 3.2 `PipelineAutoRunDebounceFirer`: D2a pre-flight cap check (at cap ⇒ re-arm with concurrencyRetryAfterSeconds, no submit); active run → `unclaim`; `TooManyRequests` → re-arm at `now + max(1, retryAfterSeconds)` with INFO, or WARN + delete on exhaustion; all other outcomes unchanged (D5)
- [x] 3.3 Rewrite `AutoRunGuardNoRetryStormSpec` to the bounded-retry contract (D6 case d) — cap exhausted ⇒ row removed, no further attempts; at most one attempt per tick; no attempt before Retry-After
- [x] 3.4 Rewrite `DatasetWriteAutoRunEndToEndSpec`'s guard-rejection case (≈line 254) to the re-arm contract; update any other existing spec that asserted row deletion on active-run/guard-reject (grep `releaseClaim`, `hasActiveRunInternal`, `pipeline_auto_run_debounce` under backend/src/test)
- [x] 3.5 Update doc comments in the firer/repository that state the old drop behaviour

## 4. Verify

- [x] 4.1 The new spec is green; the red→green delta is recorded
- [x] 4.2 Mutation checks (record the ones actually performed): firer active-run branch → `releaseClaim` turns (a) red; TooManyRequests branch → old INFO+release turns (b) red; removing the D2a pre-check turns (c)'s `request_count` assertion red; D2a re-arm → `releaseClaim` turns (c)'s row-present assertion red; removing the cap turns (d) red
- [x] 4.3 `nice -n 19 sbt testFull` for the backend (confirm `[hel1468-guard]` in output); scalafmt/code-quality checks clean
