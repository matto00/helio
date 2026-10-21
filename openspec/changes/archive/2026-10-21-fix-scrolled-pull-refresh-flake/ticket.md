# HEL-1682: Flaky e2e: hel1656-pull-to-refresh.spec.ts:221 "a scrolled page scrolls natively upward and never engages" fails intermittently on CI

## Description

origin_kind: followup
origin_ticket: HEL-1656 (observed on HEL-1631's PR matto00/helio#1072 CI)

`e2e/hel1656-pull-to-refresh.spec.ts:221` failed on an `expect.poll(...).toBeLessThan(...)` assertion in CI run
39463951430, job 118770310054 (shard e2e (2), head 3571ac6bc), the only failure in that shard. HEL-1631 doesn't touch
pull-to-refresh, and the same test passed on that PR's previous CI run (f43031a3e). The owner allowed one rerun of that
exact job while this ticket is open.

**Triage:** reproduce under CPU throttling with `--repeat-each` under the e2e lock, then find the root cause
(systematic-debugging). Make the test wait on settled scroll state instead of sampling at a time. If the gesture engages
on a scrolled page under load, fix the app instead. No retries and no bigger timeouts.

## Acceptance Criteria

- The test is shown failing first, then passes 40/40 under throttle.

## Run constraints (driver brief, overnight mode)

- Iron Laws: red first with `--repeat-each` under CPU throttle; probe-confirmed root cause; no retries, no bigger timeouts.
- Playwright under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`,
  `--trace retain-on-failure`, at most 2 workers, `nice -n 19`; `HELIO_JEST_MAX_WORKERS=2` for frontend jest.
- Load gate: if 1-min load > 10, sleep 60 s and recheck (up to 30 min) before heavy runs.
- Scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1682/`.
- No kill/pkill/pgrep/killall; stop servers only via `scripts/concertino/stop-servers.sh`.
- `files-modified.md` lists every path explicitly (CON-260).
