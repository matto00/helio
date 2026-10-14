# e2e-flake-probe.md - hel813 surface 7 (Connectors page) at 430px

- Servers: this run's own, `scripts/concertino/start-servers.sh "$WORKTREE_PATH" 6883 9790 HEL-1451` -> READY backend=http://localhost:9790/health, READY frontend=http://localhost:6883; `assert-phase.sh servers <WT> 6883 9790` -> PASS servers.
- Runner: `npx playwright --version` -> Version 1.55.1 (resolved from the main checkout's install; this worktree has no root node_modules).
- baseURL: playwright.config.ts:155 `http://localhost:${DEV_PORT}` with DEV_PORT=6883 -> http://localhost:6883 (no "DEV_PORT unset" warning in the output).
- Selection check (`--list`, same -g): exactly 1 test, 430px only:
```
Listing tests:
  hel813-mobile-touch-target-floor.spec.ts:298:11 › HEL-813 mobile touch-target floor guard › at 430px › surface 7: Connectors page
Total: 1 test in 1 file
```
- Command: `DEV_PORT=6883 nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "at 430px surface 7: Connectors page" --workers=2 --repeat-each=20 --reporter=list`
- Runs: 20 (1 test x 20 repeats), workers=2 (cap). Result: **20 passed, 0 failed, 0 retries** (52.4s wall). Per-run results with timings (3.6s-10.4s each) in `pw-run.txt` (20 lines with a pass mark).
- Conclusion: NOT REPRODUCED in 20. The report was a single failure that passed on re-run. Per the ticket/driver instruction (root-cause only if it recurs), no root-cause attempt and no e2e change were made. Not claimed fixed; a rare flake under CI load can still exist.
- Servers stopped with `scripts/concertino/stop-servers.sh "$WORKTREE_PATH" 6883 9790` -> STOPPED ports=6883,9790.
