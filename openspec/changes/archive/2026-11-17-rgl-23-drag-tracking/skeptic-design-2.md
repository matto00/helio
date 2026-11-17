## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/rgl-23-drag-tracking/HEL-1728`. HEAD reviewed: `a6499da125f7984d9d0338f09a0ef62173865382`. The only untracked path is the change dir.
- I re-read ticket.md, proposal.md, design.md (D0-D7), tasks.md (1.x-5.x) and skeptic-design-1.md. There are no TODO/TBD placeholders. AC coverage: bisect -> 2.1/2.2; adapt-or-pin -> 4.1; 20/20 -> 4.2. The driver constraints are reflected (no #926, no upstream filing, draft in the evidence dir, dependabot rule next to HEL-1725, light and dark check).
- I checked the spec's pointer sequence again at `e2e/hel1573-motion-grid-chart.spec.ts:309-327`: `mouse.down()`, then `move(+40,+10,{steps:4})` with no wait, then for each dx a `move(..., {steps:6})` (sub-steps sent back-to-back, no interval) and then `waitForTimeout(60)`.
- `frontend/vite.config.*` has no `optimizeDeps` include/exclude for RGL, so RGL is pre-bundled under `.vite/deps`. D3's "clear `.vite` + prove the served build" is the right control.

Round-1 change requests, each checked against the revised artifacts:

1. CR1 (Vite cache, overlay procedure, proving the served build): **addressed** in D3 and 2.1. Every step runs stop, `rm -rf .vite`, `rm` then copy `dist/`, start, and records the served module's sha256 plus a grep. The endpoint check uses the same procedure on the same base install.
2. CR2 (base install, restore, version recording): **addressed** in D0, the D2 fixed-base statement, and 2.3. Restore is `git checkout` of both files, then a `git status` check, then `npm ci`, and versions are re-recorded.
3. CR3 (timing sweep): **addressed** in D4, with delays {0,8,16,33,100}ms, 8ms move intervals and 5 reps each, plus resize.
4. CR4 (objective Adapt-test threshold): **partially addressed.** The threshold is now objective, but the sweep it reads does not contain the test's own sequence, so one plausible outcome is misrouted. See CR-A.
5. CR5 (minimal page): **addressed** in D5 and 3.2, at the bisected commit and its parent, with a one-at-a-time toggle of app differences.
6. CR6 (verdict and skip rule): **addressed** in D3. Good = 3/3. Bad = any failure at `item tracks the pointer`. A build failure, a crash or another assertion = skip with a note.

### Verdict: REFUTE

The plan is close. Two defects remain in the D6 decision table. Each can make the run ship a confident wrong answer without anyone deviating from the plan as written. Both are fixed by rewording the artifacts.

### Change Requests

1. **CR-A: D4/D6 have no row for "the sweep tracks everywhere but the test still fails".** The D4 sweep always moves at 8ms intervals, including its 0ms row. hel1573:275 sends its first 4 sub-steps (and each later 6-step move) back-to-back with no interval at all (spec :311, :314). So it is quite possible that every D4 row, 0ms included, tracks 5/5 on 2.3.0 while the test stays red. That outcome is the clearest "the test is wrong" signal there is. D6 sends it to "Otherwise it is a user-visible regression" and on to Adapt app or Pin. The run would then pin a non-regression and draft an upstream bug for it. Fix:
   - (a) Add the test's exact sequence (down, no-wait `steps:4`, back-to-back `steps:6`, 60ms) to D4 as a control row, 5 reps.
   - (b) Restate the Adapt-test condition as: every D4 delay >= 8ms tracks 5/5. Failures, if any, are confined to the 0ms row and/or the test-sequence control row. A failing test-sequence control row is required, which proves the sweep reproduces the red.
   - (c) If the control row itself tracks 5/5 on 2.3.0, D4 does not reproduce the red. That is an ESCALATION, not a fall-through to "Otherwise".

2. **CR-B: the Pin row assumes a library cause that D5 may not have shown.** D6 reaches Pin both when D5 shows a library cause and when D5 named an app-side trigger but no small local fix exists. In the second case there is no minimal repro, yet Pin still writes `upstream-issue-draft.md` with "the D5 minimal repro". That draft would claim an upstream bug that the minimal page did not reproduce. The ticket asks for an upstream draft only "if it is a library regression". Split the Pin row:
   - Pin + upstream draft only when the D5 minimal page reproduces.
   - Pin with no upstream draft when the trigger is app-side but no small fix exists. The dependabot reason comment names the app-side trigger instead.
   - D5 reproducing in neither the minimal page nor via any toggled app difference -> ESCALATION.

### Non-blocking notes

- D4/D5 do not say where the sweep script lives or how it runs. Keep it as a scratch spec run through the repo's Playwright config against the pinned `DEV_PORT` (never a bare `npx playwright` with ambient defaults, CON-165), and persist the script with the evidence so the sweep table can be reproduced.
- D3: a midpoint commit's build may emit entry or chunk names that the base install's `package.json` `exports` (2.3.0) do not point to. That surfaces as a resolve error, which the skip rule already covers. Note it so a run of skips is not misread.
- D6 Adapt-test fix suggestion: if the test waits on the `react-draggable-dragging` class, confirm first that 2.3.0 still applies that class on the drag handle's item. Otherwise prefer one `requestAnimationFrame` round-trip via `page.evaluate`.
