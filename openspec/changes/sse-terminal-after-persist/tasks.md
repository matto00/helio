## Standing Constraints

- [C1] Any Playwright/test/probe run uses at most 3 workers and runs under `nice -n 19`; long Bash calls use `timeout: 600000`.
- [C2] Never use the shared Playwright MCP browser or shared /tmp cookie jars; e2e screenshots only via `e2e/support/evidencePath.ts`.
- [C3] Never bypass hooks (`git commit -n`); keep full logs of any failing run under the change directory or the run's evidence dir.
- [C4] Never use pkill/pgrep/killall; delete test data only by exact id; never touch matt@helio.dev data; no prod changes.
- [C6] The red-first ordering proof is deterministic (lock-holding per design D4), never timing-based; its pre-fix log must show the ordering assertion failing.
- [C5] Do not lengthen hel1094's 120 s waits; the fix is at the root cause (terminal publish ordering).

## 1. Backend

### Backend

- [x] 1.1 Enumerate every consumer of `PipelineRunRegistry.publish` / `PipelineRunNotifyBus` and record in files-modified.md that none needs terminal-before-persist (design D3)
- [x] 1.2 Write the lock-holding red-first backend spec (design D4: gated engine, dedicated-connection locks, one connection per lock + pg_blocking_pids non-vacuity, staged release for succeeded) for succeeded, failed (exception, blocked, write-back) and dry_run, plus exactly one terminal event per run; run it on unmodified code and save the failing log showing the ordering assertion
- [x] 1.3 Move the terminal `publish` in `onUnblockedRunSuccess` to after its write chain completes (design D1/D2); verify the 1.2 succeeded case goes green
- [x] 1.4 Do the same for `executeRunFailure`, `onWriteBackFailure`, `onBlockedRun`, `onDryRunSuccess`; verify every 1.2 case is green and the existing pipeline-run/SSE specs still pass

## 2. e2e helpers

### Frontend

- [x] 2.1 Add a shared user-id helper to `e2e/support/auth.ts` (design D5) and verify `npm run typecheck`/lint pass for e2e
- [x] 2.2 Replace the local `registerThenLogin` in hel1277, hel1350, hel1351 with shared helpers, preserving email shape, display name, logs, tier order, isolate; verify by grep (zero local definitions)
- [x] 2.3 Replace the 11 local `uniqueEmail` definitions with the shared import, preserving each email shape; verify by grep that none remain outside `e2e/support/`

## 3. Verification

### Tests

- [x] 3.1 Run `sbt testFull` (or the targeted pipeline-run spec family plus full suite per gates) green and record the result
- [x] 3.2 Run hel1094 with `--repeat-each=4 --workers=2` under `nice -n 19` against this worktree's fixed backend; save the log
- [x] 3.3 Run the 14 touched e2e specs once (workers ≤ 3, nice) and save the log
