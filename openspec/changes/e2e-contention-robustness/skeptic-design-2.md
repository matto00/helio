## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed on HEAD 77bdaec8eacd775b3d85b8793016cdd0a6f24b0c (change dir untracked): ticket.md, proposal.md, design.md,
tasks.md, workflow-state.md, skeptic-design-1.md. Cross-checked against `playwright.config.ts` (testDir `./e2e`,
testIgnore list), `e2e/hel519-recent-navigation.spec.ts:82-110`, and
`frontend/src/features/commandPalette/RecentVisitsRouteObserver.tsx`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Round-1 change requests:**

- **CR1 (the greens config must be proven red): addressed.**
  - D1 now defines the "reproducing configuration" as the first config with a measured non-zero failure rate in the
    CI failure mode. It gives a calibration ladder for CDP `setCPUThrottlingRate`, an uncommitted wrapper that is
    created and deleted and recorded in `files-modified.md`, an escalate-don't-claim branch, and flip-both-ways
    confirmation.
  - Tasks 1.3 and 4.1 carry this through.
  - It is weakened by a statistical gap: see new CR 1.
- **CR2 (margin arithmetic and a headroom criterion): addressed.**
  - D3 states the ~31.7s and ~37–38s projections, and the ~27s and ~33s figures after the API-login saving.
  - It concludes that overhead removal is "not presumed sufficient".
  - It names the dominant steps for idle-vs-contended measurement as product-slowness candidates.
  - It sets max ≤ 27s (≥10% headroom), with an escalate path. Tasks 2.2 and 4.1 carry this.
- **CR3 (exhaustive D2 tree): addressed.**
  - Branches A–D now include the untitled entry skipped by `useRecentPaletteActions` (C), and "rendered, nothing
    recorded" (D).
  - There is a keep-probing catch-all, and mixed outcomes get one fix per branch.
  - Task 2.1 instruments the title, the prune and the render per attempt.
- **CR4 (Standing Constraints): addressed.** tasks.md C1–C6 cover every item I asked for. They match
  workflow-state.md `CONSTRAINTS`.
- **Round-1 non-blocking timing note: addressed.** D1 states the time origin ("measured from the first trace event",
  ~29.1s and ~29.5s) and notes that run 2's terminal error is on "Dashboard actions".

**Design premises re-checked against the tree:**

- hel519 main:84-95 matches the ticket. The test goes from `waitForURL` straight to the sidebar click, with no
  detail-view wait. Its sibling (pipeline direct URL, :106) does wait on the heading. D2(A)'s fix shape is grounded.
- `RecentVisitsRouteObserver` records in a `useEffect` keyed on `location.pathname`, `sources` and `pipelines`. Its
  self-heal re-record happens only while the URL is still `/sources/:id`. The C branch is a real possibility.
- The wrapper filename `e2e/zz-hel1298-throttle-probe.spec.ts` is under `testDir` and matches no `testIgnore` pattern,
  so it would run.

**Scope:**
- No planned edits to `playwright.config.ts` or `ci.yml`.
- No quarantine.
- Assertions and `io` counts are kept.
- `test.setTimeout`/`test.slow()` are explicitly rejected.
- Product edits are confined to `commandPalette/**`, and only on a proven product branch.

### Verdict: REFUTE

The round-1 fixes are real. However, D1 still accepts any non-zero failure rate as "reproducing". Under that rule the
≥20-consecutive-greens AC can pass by chance on an unfixed spec. That is the same evidence-shaped non-evidence that
round-1 CR1 was meant to close, and this design does not yet close it. Both fixes are small text edits.

### Change Requests

1. **D1 + tasks 1.2, 1.3, 4.1: require a minimum failure rate for the reproducing configuration, measured over a
   stated sample.**
   - **The problem.** "First one with a measured non-zero failure rate" lets a config that went red once in, say, 30
     attempts become the greens configuration. At p ≈ 3–5%, an unchanged spec passes 20 straight runs with
     probability (1−p)^20 ≈ 36–54%. The ≥20 greens would then not distinguish fixed from unfixed. The same weakness
     hits the "cause removed → green" half of the flip-both-ways confirmation.
   - **The fix.** Revise D1 so a config counts as reproducing only if the unchanged spec's measured failure rate p
     satisfies (1−p)^20 ≤ 0.05, i.e. p ≥ ~14%. Measure p over a stated sample (e.g. ≥20 attempts) and record the
     count, for example "7/20 red".
   - If a config falls short, keep climbing the throttle ladder, optionally combined with host contention.
   - If no permitted config reaches the threshold, escalate with the numbers rather than claim the AC. This mirrors
     the existing no-reproduction branch.
   - Apply the same threshold to the "cause removed → green" probe: it must use at least as many attempts as would
     have shown ≥1 red at the measured p.
   - hel910's ≤27s duration criterion is an independent signal and stays as is. This CR matters most for hel519,
     where green or red is the only signal.

2. **D1: the greens must exercise the committed spec, not a drifting copy.**
   - **The problem.** D1 offers two wrapper shapes:
     - "an untracked wrapper spec importing the test body". Playwright refuses to let one test file import another,
       so this route is likely not viable as written; verify it at execution.
     - "a `test.beforeEach` in an untracked copy". In this route the 20 greens run against a copy, and nothing ties
       that copy to the file that gets committed.
   - **The fix.** Require the following, and add it to task 4.1's evidence list:
     - (a) The executor records `diff <committed spec> <throttled copy>` at the time of the greens run, showing the
       only difference is the throttle hook and its import.
     - (b) The diff is re-checked if the committed spec changes after the greens. Any later edit to either spec
       invalidates the run and requires a re-run.

     A fixture-only mechanism that leaves the spec file itself untouched is an acceptable alternative, for example an
     untracked helper that the run loads without modifying the spec. Whichever is used, name it in D1.

### Non-blocking notes

- CDP throttling slows only the renderer. The CI failures also had vite, the backend and postgres on a contended
  4-vCPU runner. If throttling alone reproduces the failure, record that this is an approximation of the CI mode.
  The planned confirmatory CI run (Risks) is the right backstop.
- D3's ≤27s criterion is measured under the reproducing (throttled) configuration. If the calibrated rate is harsh,
  meeting 27s may be impossible even for a correct fix. The escalate path covers this, but state the rate in the
  escalation so the owner can judge it.
- Self-approved D2 wording ("a click whose route never rendered is not a visit") is reasonable. Recording on URL
  change would be a behavior change, which is correctly deferred.
