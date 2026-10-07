# HEL-1298 root-cause evidence

## Owner rulings (all `answer_source: human` in `.concertino/runs/HEL-1298/events.jsonl`, verified)
- `remeasure-on-quiet-host`, escalation HEL-1298-1791268232005-451d3f: re-measure hel910 on a quiet host.
- `accept-and-waive-27s`, escalation HEL-1298-1791334299309-2c65fc: hel910 quiet-host f8 = unfixed 18/20 red at 8x; fixed 20/20 green, max 28.0s, p50 27.2s. The D3 27s bar is waived. Product follow-up (pipeline-detail boot cost) filed as HEL-1354.
- `rule-header-edit-does-not-invalidate-greens-then-respawn-for-artifacts-only`, escalation HEL-1298-1791347289159-0ed921: the upstream merge added only HEL-1288's `test.describe.configure({ mode: "parallel" })` header and comment to the hel519 spec; test bodies are unchanged. It does NOT invalidate the hel519 greens run against d0cbe62a5. This is the C8 resolution for hel519 (evaluation-1 change request 2); no re-run was done.

**Supersession.** The loaded-host hel910 reproducing config (5x) in the D1 section and the "Escalated, not delivered as done" sentence in the hel910 section below are superseded by the quiet-host 8x remeasure (section at the end) and the `accept-and-waive-27s` ruling. Batch A 21/25 is kept as labelled loaded-host history.

Host: 6c/12t, load average 10-17 throughout (other lanes running); every number below includes that ambient load.
Method: Playwright 1.55.1, `--workers 2`, `nice -n 19`, DEV_PORT=6730 (this worktree's servers; serving cwd verified =
worktree), explicit file + `-g`. Throttle = untracked copy `e2e/zz-hel1298-*.spec.ts` whose only difference from the
spec under test is a top-level `test.beforeEach` calling CDP `Emulation.setCPUThrottlingRate` (diff shown below).
Burners: 3 niced `while :; do :; done` under `timeout 3000`, PIDs 695449/695450/695451 (+children 695453/4/6); they
self-expired at 50 min, none killed by pattern.

Throttle diff (identical for both copies; vs committed spec at the time, captured per batch):
```
1a2,5
> test.beforeEach(async ({ page }) => {
>   const cdp = await page.context().newCDPSession(page);
>   await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.HEL1298_THROTTLE ?? "1") });
> });
```
"Unfixed" copies were generated from `git show HEAD:<spec>` (pre-fix); "fixed" copies from the edited spec.

## D1 reproduction (unchanged spec)
| spec | config | red |
|---|---|---|
| hel519 | host contention only (2 workers + 3 burners, no throttle) | 0/20 and 0/20 |
| hel519 | throttle 4x + burners | 0/20 |
| hel519 | throttle 6x + burners | **10/30 (33%)**, all "Recent group not found" |
| hel519 | throttle 8x + burners | 12/20 (60%) |
| hel910 | throttle 1x / 4x / 6x (n=6/6/10) | 0/6 (13.7s), 0/6 (24.0s), 10/10 (30.6-31.6s) |
| hel910 | **throttle 5x + burners** | **14/20 (70%)**, 30s test timeout; the 6 passes took 26.8-28.8s |

Reproducing configs (p >= 14%, (1-p)^20 <= 0.05): hel519 = 6x + 3 burners + 2 workers; hel910 = 5x + 3 burners + 2 workers (**superseded, loaded-host only**: on the quiet host the reproducing config is 8x, see the quiet-host remeasure section).

## hel519 root cause (D2 branch A, test defect)
Probe `zz-hel1298-probe-hel519` (8x): init script logs `pushState`, `localStorage.setItem('helio.recentVisits')`, detail heading appearance.
- 20 attempts, 9 red. Every red attempt (9/9, classified A): `pushState /sources/<id>` then `pushState /pipelines`, **no `setItem` ever, no detail heading ever**, storage `null` after the 5s+10s palette waits. Route never committed => the post-commit effect in `RecentVisitsRouteObserver` never ran. No B/C/D case observed. (An earlier probe that added a `page.evaluate` dump before the palette perturbed timing and went 20/20 green; logged rows show `setItem` landing after the second pushState, confirming the commit is simply late.)
- Cause removed (add only `expect(heading).toBeVisible()` before the sidebar click, probe `HEL1298_FIXED=1`): **0/20 red** at the same 8x.
- Fix (3 sites with the same shape: list-click, persist, typing tests): heading wait after `waitForURL`; assertions unchanged. The pre-existing "root-landing" test already carries this wait with the same rationale (prior art).
- Greens: fixed copy, 6x + burners + 2 workers, **25/25 green**, durations min 9.8 / p50 11.4 / p95 13.0 / max 13.6s (unfixed was 33% red). At 8x the fixed copy was 23/25: both reds were in `registerAndLogin` / `page.goto` setup (5s boot expect, 30s goto) as host load hit 16 — a different mode (beyond CI envelope), not the Recent defect; recorded, not claimed as green.
- Uncontended full file after fix: 8/8 pass (31.6s). hel519 greens batch for 6x: `g519-r6.txt` (scratch).

## hel910 (3.2 / 3.3)
Per-step timing (probe copy, same spec, click helper logging): idle (1x) total ~11s: register+UI login 1.7s, `goto /pipelines`+New pipeline 0.35s, Outputs tab 0.19s, `goto /`+heading 1.1s.
At 6x: login 4.3-5.2s, New pipeline click 3.1-3.8s (page boot), Outputs tab 2.6-3.4s (14-18x idle; pipeline detail fires 7 parallel API calls whose responses complete ~300ms apart, tab becomes clickable ~0.3s after the last; includes duplicate `run-history` GET — a product inefficiency, not shown to be the cause), `goto /`+heading 4.6s. No single stalled step; cost is cumulative boot/render under throttle, matching the CI traces.
Fix (D3 "unmeasured overhead", counts/assertions untouched): API register on `page.request` instead of UI login (removes one full app boot + form), dashboard seeded before first page load. `io.click` count unchanged (28), `toBeLessThanOrEqual(30)` unchanged, no timeout change.
Flip (loaded-host history, superseded by the quiet-host 8x remeasure): unfixed 14/20 red at 5x (passes 26.8-28.8s) -> fixed batch A 21/25 green (4 reds 30.7-31.6s, all while host load rose to 16; passes 23.7-28.1s), batch B **20/20 green**, 17.9-26.0s (p95 25.8, max 26.0).
**[SUPERSEDED by the quiet-host remeasure and the `accept-and-waive-27s` ruling; kept as history]** D3 robustness criterion (max <= 27s under the reproducing config) was not met across loaded-host batches (batch A: passing max 28.1s and 4 reds). It was escalated; the owner then waived the 27s bar (quiet-host f8: 20/20 green at 8x, max 28.0s, p50 27.2s). Remaining wall-clock is the two necessary app boots + 3 picker cycles under throttle; going lower needs changing the scenario or product boot/render cost (see escalation).
Uncontended full file after fix: 2/2 pass (12.9s; full-flow 9.8s vs 13.7s before).

## D4 HEL-1289 verdicts
- hel519 failing test: seeding the source via API happens while `/` is live, but the test then does `page.goto("/sources")` (fresh store) before relying on it; probe A shows the failure is an uncommitted route, not a stale list. Race does **not** apply to / did not cause the failure. Other hel519 tests keep the UI-login-then-seed shape; they all `goto`/`reload` before reading seeded data (not touched; HEL-1300 territory per scope).
- hel910: old shape applied (UI login lands on live `/`, then API seeds dashboard) but each failing step follows a fresh `goto`, and the timing data shows cumulative cost, not a lost seed. Did not cause the failure; the fix retires the shape anyway (seed before first load).
- HEL-1300's claim on "a full reload's auto-selected dashboard is recorded under Recent": **not supported**. Probe: `localStorage['helio.recentVisits']` is `null` both before and after seeding (fresh user has no dashboard when live `/` fetched), 3/3 pass; also 3/3 pass with the key explicitly removed before `reload()`. So the reload really is what records the dashboard; the test passes for the right reason. No follow-up needed.

## Dev DB residue
Moved out of the change dir; see files-modified.md (persisted via persist-evidence.sh). Nothing deleted.

## Quiet-host remeasure (2026-10-06) -- hel910 only
Branch at 84ad6eb37 (origin/main merged over d0cbe62a; specs unchanged upstream). Own servers: vite 3382061 / backend 3381857, cwd verified = this worktree.
Load gate: every batch started only with 1-min load < 2 (waits via await-sentinel.sh, bounded). A per-batch sampler wrote loadavg + top-5 `ps` every 15s. Config: throttle R + 3 niced burners (recorded PIDs, killed by PID) + 2 workers + nice 19.
Unfixed copy = `git show d0cbe62a~1:e2e/hel910-...` + hook; fixed copy = committed spec + hook; both diffs identical and hook-only (the 4-line `beforeEach` above), captured at generation time.

| batch | spec | rate | load before / after | result | duration min/p50/p95/max |
|---|---|---|---|---|---|
| u5 | unfixed | 5x | 0.83 / 12.19 | 0/20 red -- **CONTAMINATED** (another lane's sbt test JVMs seen in 3+ samples), not counted | 21.1/26.0/28.5/28.5 |
| u6 | unfixed | 6x | 0.84 / 9.32 | 1/20 red (5%); late samples show other-lane forked-test JVMs (partly contaminated) | 23.3/24.1/29.9/30.6 |
| u8 | unfixed | 8x | 0.44 / 6.71 | **18/20 red (90%)**, 30s test timeout; clean (only my burners/chromium) | 29.8/30.4/31.0/31.1 |
| f8 | **fixed** | 8x | 0.51 / 6.48 | **20/20 green**; clean | 26.8/27.2/27.6/**28.0** |
| u7 | unfixed | 7x | 0.58 / 5.88 | 0/20 red (all green 26.5-27.2); clean | 26.5/26.9/27.2/27.2 |

(Loads "after" include my own 3 burners + 2 workers.) Reproducing config: 8x (unfixed 18/20 red). At that same config the fixed spec is 20/20 green (the fix flips 18/20 red -> 0/20 red) but **max 28.0s > 27s bar** (17 of 20 runs above 27.0s; p50 27.2). At 7x the unfixed spec does not reproduce, so no config satisfies both D1 (p>=14%) and D3 (max<=27). The quiet host is much faster than the loaded one (5x: unfixed 0/20 red here vs 14/20 loaded), so the earlier numbers were dominated by ambient load.
Logs: scratchpad `executor/q/{u5,u6,u7,u8,f8}.{log,meta,samples}`. 100 new users: see files-modified.md.

## hel519 C8 resolution and cycle-2 quiet-host unfixed batches (informational only)
C8 for hel519 is resolved by the header-only ruling above (HEL-1298-1791347289159-0ed921); the 25/25 greens at 6x against d0cbe62a5 stand.
Cycle-2 quiet-host unfixed hel519 batches, recorded as informational context only. They are NOT a reproducing config and no claim rests on them (logs: scratchpad `executor/r/{u6,u8}.{log,meta}`):
- u6 at 6x: 0/20 red (20 passed, 1.6m; load before 0.75, after 5.70).
- u8 at 8x: 1/20 red (19 passed, 1 failed, 1.9m; load before 1.16, after 5.38).
So on the quiet host the hel519 6x/8x configs no longer reproduce at p >= 14%, consistent with the hel910 loaded-vs-quiet finding.
Dev-DB users from these two batches (40) and the evaluator's 10 are recorded by exact id/email in `dev-db-residue-cycle2.txt` next to the existing residue record (persisted evidence dir, not committed). Nothing deleted.
