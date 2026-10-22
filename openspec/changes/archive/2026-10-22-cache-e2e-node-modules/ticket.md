# HEL-1699: e2e-prod-build follow-ups: 8-min timeout too tight for slow npm ci (cache node_modules), and `npm run e2e:prod-build` can't run inside a lane (backend CORS pinned to DEV_PORT)

## Description

origin_kind: followup
origin_ticket: HEL-1691 (PR matto00/helio#1084), observed on HEL-1632 (PR matto00/helio#1075)

**1. CI timeout.** On PR #1075's run 39711300255 (2026-10-21), `npm ci` took about 7 minutes per install, against the usual well under 1 minute.

* `e2e-prod-build` was cancelled at its 8-minute timeout twice: once during `npm --prefix frontend ci`, once 20 s into the test step.
* `e2e (2)` was cancelled at 25 min twice.
* The same jobs passed on main a few hours earlier in about 3.5 min.

Fix: cache `node_modules` (or `~/.npm`) keyed on the lockfiles, in the shared e2e setup action (HEL-1698 is extracting it), and/or give `e2e-prod-build` a timeout that accounts for install variance. Raising timeouts is an owner call; caching isn't.

**2. Local prod-build run inside a lane.** `npm run e2e:prod-build` doesn't work there:

* the backend's CORS allowlist is pinned to the lane's DEV_PORT, but the preview serves on another port (7065 in the HEL-1632 lane);
* there is no backend-only start in the concertino server scripts.

HEL-1632's executor had to start the backend by hand with CORS for the preview port. Make the harness pass the preview origin to the backend, or serve the preview on DEV_PORT.

## Acceptance Criteria

- Item 1 shows install time cut, or the timeout raised by owner ruling, across 5 CI runs.
- Item 2 lets a lane run `npm run e2e:prod-build` end to end with the documented scripts.

## Driver constraints (binding for this run)

- No timeout is raised in this change (an owner call; escalate instead).
- Never read, cat, grep or print any `.env` file (CON-261). For CORS config read the code that loads it (`backend/src/main/scala/com/helio/app/Main.scala`).
- File content via quoted heredocs (`<<'EOF'`) or the Write/Edit tools only.
- No kill/pkill/pgrep/killall; never signal a parent or grandparent; stop servers only with `scripts/concertino/stop-servers.sh`. A backend-only start's stop path must go through that script.
- Worker caps: at most 2 workers, `nice -n 19`, `HELIO_JEST_MAX_WORKERS=2` for frontend jest. Playwright under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`; `sbt testFull` under the same dir's `sbtfull.lock`. Load gate: if 1-min load > 10, sleep 60 s and recheck (up to 30 min).
- Before pushing, run the CI script checks locally, including `check-ci-sbt-no-pattern-kill` (scans the action).
- `files-modified.md` lists every path explicitly (CON-260).
