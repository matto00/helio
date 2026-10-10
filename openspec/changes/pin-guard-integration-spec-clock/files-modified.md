- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala` — pins `guardClock` (PinnedGuardClock, 2026-01-01T00:30:00Z) in `newService` and `newGatedService`; exact `retryAfterSeconds shouldBe 1800L`; corrects stale HEL-1195 "no clock-injection seam" comment.
- `openspec/changes/pin-guard-integration-spec-clock/*` — change artifacts and evidence (probe-red.txt, probe-green.txt, loop-logs/, loop-exit.txt, tasks.md).

## D4 sweep (other specs touching the rate-window guard)
- `AutoRunGuardBurstProofSpec`, `DatasetWriteAutoRunEndToEndSpec` — already pass `guardClock` (HEL-1439/HEL-1374 precedent). No change.
- `PipelineRunGuardRepositorySpec` — passes explicit `now` to every repository call. Not exposed. No change.
- `AutoRunGuardNoRetryStormSpec` (limit 0, line 159) — not boundary-sensitive: `limit < 1` short-circuits and denies in every bucket.
- `PipelineRunServiceTerminalOrderingSpec` (GenerousGuard limit 1000; rate case limit 0 at line 556) — not boundary-sensitive: budget cannot be exhausted / is denied in every bucket.
- `FireTimeRunConfigGateSpec` (limit 1000, line 98) — not boundary-sensitive: budget far above submission count, and its budget probe sums `request_count` across all windows so a split cannot change it.
- `InMemoryRateLimiterSpec`, `RateLimitDirectiveSpec` — different class: first-request-anchored window (not epoch-aligned), no clock seam. Not changed.
No other spec fixed; none boundary-sensitive.
