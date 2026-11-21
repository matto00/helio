## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file or run env-dumping commands; never copy a tree containing one.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; delete residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers total and one Playwright batch at a time, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; nothing backgrounded past the tool timeout.
- [C6] Lane-private DB helio_hel1808: DATABASE_URL for start-servers.sh, Playwright, e2e cleanup and hook runs.
- [C7] Backend started with ANTHROPIC_API_KEY exported empty (no live model call).
- [C8] LONG_TASK_BOUND_MS stays 100; red/attribution output committed as .txt before the reshape.
- [C9] e2e only: no app/backend/schema code; avoid HEL-1796 and HEL-1813 files.
- [C10] Owner ruling margin-note: keep attribution logging; frame and LONG_TASK_BOUND_MS=100 unchanged; HEL1808_CPU_THROTTLE defaults off and cannot change CI; PR states remaining margin and cause.

## 1. Attribution (before any reshape)

- [x] 1.1 Create lane DB helio_hel1808, start servers on 7240/10147 with ANTHROPIC_API_KEY empty
- [x] 1.2 Add LoAF + request-timeline diagnostics to the control, probe and overrun windows; run the current spec at 1x, 4x, 6x throttle
- [x] 1.3 Commit attribution output as .txt evidence; write which Decision 2 rule applies and why

## 2. Reshape

- [x] 2.1 (superseded by owner ruling margin-note: no reshape) Reshape the control, probe and overrun windows per the chosen rule (named settle constant); bound stays 100
- [x] 2.2 Keep the control/probe/overrun log prefixes; add the attribution summary to each line

### Tests

- [x] 3.1 Full spec file locally x5 at 1x: all three windows <= 60 ms (pass gate); x3 at 4x/6x old vs new: diagnostic only, record (the "new" shape was attempted and reverted under C10; see attribution-new-shape.txt)
- [x] 3.2 Mutation: targeted scratch disable of the HEL-1683 client decline (diff recorded), probe red with measured duration; restore
- [x] 3.3 Mutation: inject a 150 ms busy loop in client extractRegex, control red; restore
- [x] 3.4 Lint/format/typecheck for e2e

### Delivery (orchestrator)

- [ ] 4.1 Record control/probe/overrun on 5 PR CI runs (max 6) with each leg's CPU model from e2e-runner-shard-<n>
