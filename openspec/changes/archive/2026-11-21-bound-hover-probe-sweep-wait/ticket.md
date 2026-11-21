# HEL-1813: Flake: hel1790-hover-probe:27 (dark) hangs the full 240 s in waitForFunction

## Description

`e2e/hel1790-hover-probe.spec.ts:27` › "HEL-1790 guard: the select trigger's rest read is not hovered (dark)" has hung for the full 240 s test timeout in `page.waitForFunction` twice:

* HEL-1722's PR #1197: `e2e (4)` failed and passed on a single rerun (run 44803300832, job 136532369427).
* Main run 44873260203 (2f6d44104, 2026-11-21): `e2e (4)`, job 136752280174.

It costs 4 minutes of a leg each time, and the 8-leg e2e has only about 20 s of headroom on slow hosts (HEL-1793).

## Do

* Find what the `waitForFunction` waits on and why the condition never becomes true in dark mode on CI.
* Fix the wait or the probe. Also make the probe fail fast with a clear message (a short explicit timeout on the wait) instead of using up the test timeout.
* Keep the guard's ability to fail. Re-run the HEL-1790 mutation and show it still goes red.

## Acceptance criteria

- [ ] The root cause is stated with evidence.
- [ ] The spec passes 20 times in a row locally (2 workers, `nice -n 19`), and its worst-case run time is bounded well under 240 s.
- [ ] The HEL-1790 mutation still turns it red.
