## 1. Probe (Backend) — mandatory before any fix

- [x] 1.1 Read `.concertino/laws/systematic-debugging` and the RLS repro notes; start worktree backend + dev DB
- [x] 1.2 Inspect `usePipelineRunEvents.ts` / StepCard to capture the exact request the frontend issues (auth, reconnects)
- [x] 1.3 Add temporary stack-trace logging at the `Failure(ex)` branch in `PipelineRunStreamRoutes`
- [x] 1.4 Probe happy path: owned pipeline, session cookie and PAT auth, expect 200 `text/event-stream`
- [x] 1.5 Probe pipeline states: never-run, running, completed, failed, deleted-mid-stream
- [x] 1.6 Probe shared-grantee path (editor/viewer) — exercises `UUID.fromString` + `withUserContext` grant query
- [x] 1.7 Probe concurrent streams (multiple subscribers + a posted run)
- [x] 1.8 Probe non-superuser RLS context per team RLS notes; review V40 + pipeline/permission policies
- [x] 1.9 Record probe matrix results + captured stack trace(s); identify or exonerate each candidate cause

## 2. Fix (Backend)

- [x] 2.1 Fix the probe-confirmed root cause at the correct layer — N/A: 500 not reproducible across the full matrix (every candidate exonerated). See `probe-report.md`. Fallback (2.4) applied.
- [x] 2.2 Harden `PipelineRunStreamRoutes` `Failure(ex)` branch: log exception + stack trace, return generic 500 body
- [x] 2.3 Remove temporary probe logging — the hardened logging from 2.2 is the permanent form; no separate temporary logging remained
- [x] 2.4 Not reproducible after full matrix: documented probe report written (`probe-report.md` — matrix, evidence, exonerations)

## 3. Tests

- [x] 3.1 Regression test: locks the design-flagged suspect (viewer-grantee path — the only path running `UUID.fromString` + `withUserContext` grant query) at 200 `text/event-stream`
- [x] 3.2 Test: guard future failure yields 500 with generic body (no exception message leaked), via stubbed failed future — verified failing before the fix, passing after
- [x] 3.3 Run backend suite (`sbt test`), frontend gates (N/A — no frontend files changed) — backend all green (1391 passed)
