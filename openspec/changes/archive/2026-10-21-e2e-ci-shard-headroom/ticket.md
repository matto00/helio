# HEL-1698: e2e CI headroom: legs still reach ~24 of 25 min — split hel1575-dashboard-tabs (717 s) and other heavy specs and/or add a fifth shard

## Description

Follow-up of HEL-1667 (PR #1087, merged as b23656068).

After HEL-1667's reweighting, e2e legs still run close to the 25-minute `timeout-minutes`. Post-merge main run 39702872388 had legs of 1213, 1353, 987 and 1449 s, the slowest at 24m09s. Runner speed varies 20–30% between legs in a single run, so reweighting alone can't add headroom. Leg cancellations at the timeout have already cost reruns on PRs #1082 and #1084.

**Options (measure first):**

1. Split the heaviest specs so the planner can spread them. hel1575-dashboard-tabs alone is 717 s; list the top 10 by weight.
2. Add a fifth e2e shard, and check the account's concurrent-job cap first.
3. Cut per-test cost suite-wide. HEL-1689 found that `registerAndLogin({ waitForShell })` pays for a `/home` load plus a `/dashboards` load per test since HEL-1578.
4. Only as a last resort, and as an owner call: raise the timeout.

Also from HEL-1667:

* add a committed selftest for `scripts/check-e2e-slow-results.mjs`, wired into CI;
* extract a shared composite action for the e2e setup (`e2e-slow.yml` copies it from `ci.yml`);
* update the stale `ci.yml` comment "Slowest leg measures ~7 min".

## Acceptance Criteria

- Across 5 consecutive all-green main runs, the slowest e2e leg stays at or under 20 min, with before and after tables from real CI runs.

## Driver constraints (binding for this run)

- CON-261: never read, cat, grep or print any `.env` file, including a worktree's `backend/.env`.
- Owner calls (escalate, never decide): raising the timeout; a fifth shard's runner cost if material; any change that weakens what a test covers.
- Weights: regenerate only with `scripts/e2e-shard.mjs weights` from complete CI artifacts. Never hand-edit `e2e/shard-weights.tsv`.
- Splitting a spec: file moves only, every assertion byte-identical, coverage unchanged.
- Do not split/move `e2e/hel1632-live-output.spec.ts` or any `e2e/hel1668-*` spec (open sibling PR #1075, HEL-1632).
- Playwright runs under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`; at most 2 workers under `nice -n 19`; `HELIO_JEST_MAX_WORKERS=2` for frontend jest; before heavy runs, if 1-min load > 10 sleep 60 s and recheck (up to 30 min).
- No kill/pkill/pgrep/killall; never signal a parent or grandparent process.
- `files-modified.md` lists every path explicitly, including moved and deleted spec files (CON-260).
- Run CI script checks locally before pushing; run the full e2e suite locally under the lock before Delivery.
- Known flakes (one rerun of that exact job allowed if the only failure, recorded in the PR body): hel1584 :493, hel1575 :593, hel1582 :46, hel1573 :103, hel1510 :35, hel1656 :247.
