## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/rgl-23-drag-tracking/HEL-1728`. HEAD reviewed: `a6499da125f7984d9d0338f09a0ef62173865382`.
- I re-read ticket.md, proposal.md, design.md (D0-D7), tasks.md (1.x-5.x), skeptic-design-1.md and skeptic-design-2.md. There are no TODO/TBD placeholders.
- AC coverage: bisect -> 2.1/2.2; adapt-or-pin, with a dependabot rule and an upstream draft only for a library regression -> D6 / 4.1; 20/20 at 2 workers -> D7 / 4.2.
- Driver constraints: red first (D1), running-app check in light and dark (D4, 4.3), no #926 and no upstream filing (C6), draft written to the evidence dir (D6). All are reflected.
- Ground truth, re-checked at HEAD:
  - The pointer sequence at `e2e/hel1573-motion-grid-chart.spec.ts:309-330` matches design's description: down, a no-wait `move(+40,+10,{steps:4})`, then three `steps:6` moves each followed by a 60ms wait, and the assertion `|moved-dx| < 30` with `transition` `none`.
  - The `/frontend` npm block in `.github/dependabot.yml` has the HEL-1725 `ignore:` list, so the Pin row's target and syntax (`dependency-name` / `versions: [">=2.3.0"]`) are real.
  - `DesktopPanelGrid.tsx:184-205` matches design's Context, except that the compactor is the named constant `noCompactorPreventCollision`, not an inline spread (immaterial).
  - The D7 specs exist: `hel1230-drag-then-create-persists.spec.ts` and `hel908-trunk-reorder-drag.spec.ts`.

Round-2 change requests, each checked against the revised artifacts:

1. **CR-A (control row / no fall-through): addressed.**
   - D4 adds the test's exact sequence as a control row, 5 reps.
   - D6's first row escalates when the control row tracks 5/5 (no fall-through).
   - The Adapt-test row now requires three things: every delay >= 8ms tracks 5/5, failures are confined to the 0ms row and/or the control row, and the control row fails.
2. **CR-B (Pin split): addressed.** D6 now has three rows:
   - Pin + upstream draft only when the D5 minimal page reproduces.
   - Pin with no draft, with a reason naming the app-side trigger, when an app trigger exists but has no small fix.
   - ESCALATION when neither reproduces.
3. **Round-2 non-blocking notes: also taken up.**
   - The sweep is a persisted scratch spec run through the repo's Playwright config against the pinned DEV_PORT (CON-165).
   - The resolve-error skip is noted in D3.
   - The `react-draggable-dragging` class is used only after confirming 2.3.0 still applies it; otherwise a rAF round-trip.

Round-1 CR1-CR6 remain addressed as round 2 recorded: D3 per-step stop, `.vite` clear, rm+copy `dist/`, and a served-build sha256; D0 restore via `git checkout`, then `npm ci`, with versions recorded; the D4 sweep; an objective threshold; the D5 minimal page; the D3 verdict/skip rule. I re-read each in the current design.md.

I looked for new defects in the decision table. I found no outcome of D4/D5 that reaches a fix row without a measured justification, and no row that ships an upstream draft without a minimal repro.

### Verdict: CONFIRM

### Non-blocking notes

- **D5 toggle list.** `dragConfig` and `resizeConfig` are inline object literals (`DesktopPanelGrid.tsx:196-197`), so they get a new identity on every render. Given the #2240 GridItem memoization suspect, name "stable `dragConfig`/`resizeConfig` identity (useMemo)" explicitly as one of D5's one-at-a-time toggles rather than leaving it under "re-render pattern".
- **D3 endpoint check failure.** D3 does not say what happens if the endpoint check fails (2.2.4 build red, or 2.3.0 build green, on the fixed base). It should stop and escalate rather than proceed.
- **D2 green.** If D2 comes out green (react-resizable is the cause), "the same D3 procedure" means overlaying react-resizable's `dist/`, not RGL's. The Pin row still targets RGL, because 2.3.0 requires `react-resizable ^3.2.0`.
- **Task order.** Task 2.3 restores to 2.2.4, and 3.1/3.2 then need a 2.3.0 install again. D0 governs that reinstall; record the versions there too.
- **0ms vs 8ms rows.** The Adapt-test threshold tolerates a 0ms-only failure. The 8ms row lands inside a 16.7ms frame for a fraction of reps, so it partly samples the no-frame window. If the 8ms row is borderline (for example 4/5), treat it as a failure as D6 states. Do not round it up.
