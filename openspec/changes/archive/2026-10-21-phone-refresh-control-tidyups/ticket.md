# HEL-1681: Phone dashboard after HEL-1656: a visible refresh control (WCAG 2.5.1 single-pointer alternative to pull), plus pull-indicator tidy-ups

## Description

Follow-up of HEL-1656 (PR #1071, merged as 538a867d7). Parent epic HEL-1570.

1. **Accessibility.** Pull-to-refresh is the only way to refresh the phone dashboard stack; there is no visible refresh control. WCAG 2.5.1 (Pointer Gestures) needs a single-pointer alternative. Add a visible refresh control that triggers the same once-per-output-bound-panel fan-out.
2. **Collapsed chart card (pre-existing).** Under Full motion, the phone-stack chart card sometimes stays collapsed after first load: the axis shows but no bars. Seen 1 in 4 on base. Investigate and fix.
3. **Duplicated constant.** `--pull-indicator-height: 48px` (CSS) must equal `PULL_HOLD_PX` (JS), kept in sync only by a comment. Derive one from the other or add a guard.
4. **Settle label.** Under Full motion, after a refresh, the indicator shows "Pull to refresh" for about 270ms while the stack settles.
5. **Flaky test.** `hel1575-dashboard-tabs.spec.ts:593` ("an expired tab (16 minutes) refetches its panels") failed once in a full local run and passed 63/63 on repeat. Possibly load-sensitive.

HEL-1656's UI decisions, which the owner may revisit (listed in PR #1071): the compact pill straddling the first card under Subtle/Off, and the thresholds (damping 0.5, cap 112, threshold 64, hold 48, flick from 75%).

## Acceptance Criteria

- Item 1 is keyboard- and single-tap-operable, with an e2e test that fails first.
- Items 2–4 are fixed or measured.
- Item 5 is triaged.

## Run constraints (driver brief, overnight mode)

- Out of scope: the Table resize-handle `touch-action` bug (filed separately).
- Item 5: triage; stop and report if the fix gets large.
- Reversible UI decisions: build the recommended option, list each under "UI decisions taken overnight" in the PR body, screenshots in `/home/matt/Development/helio/.concertino/scratch/HEL-1681/`.
- DESIGN.md is binding. Compare against the running app at 375 and 430 with touch emulation, light and dark, under Full, Subtle and Off motion. Desktop must be unchanged.
- Keep `e2e/hel1656-pull-to-refresh.spec.ts` green (including HEL-1682's fix at :221).
- Resource caps: at most 2 workers, `nice -n 19`, `HELIO_JEST_MAX_WORKERS=2` for frontend jest; Playwright runs under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`, `sbt testFull` under the same dir's `sbtfull.lock`; Playwright with `--trace retain-on-failure`; load gate (1-min load > 10 → sleep 60 s, recheck, up to 30 min).
- No kill/pkill/pgrep/killall; stop servers with `scripts/concertino/stop-servers.sh`. Delete test data you create by exact id.
