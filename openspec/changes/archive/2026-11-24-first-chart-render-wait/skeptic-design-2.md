## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 1737116227ffc2d99c28262b0fb7427ea2db20eb. The change-dir artifacts are untracked.

### What I verified (with evidence)

**Round-1 change requests, checked against the current artifacts:**

- **CR1 (false seed-race premise): addressed.** design.md Context now says `seedWorld` (`motionPrimitivesSeed.ts:15`)
  awaits its `/run` POST (:50), and that `POST /run` answers only after the run is terminal. It cites the submit
  route, `ServiceResponse` `onSuccess`, the executor and the succeeded-writes lines. The "no rows at first load → up
  to a 15 s poll" inference has been removed.
- **CR2 (probe (a) only confirms the code reading): addressed.** D1(a) records the `/run` response and
  `GET /runs/latest`. It also states that a non-terminal run after a 2xx is "an app defect to explain, never a reason
  to add a poll".
- **CR3 (full first-render chain): addressed.** D1 now records the start and end of every request relative to
  `goto`: session → dashboards list → which dashboard opens → panels → rows/aggregate → chunk → ECharts init and box
  size. It also records which requests are still pending when the 5 s lapses.
- **CR4 (decision tree): addressed.** In D2 the seed/backend branch is explicitly "NOT the default". D2 adds a
  data-request branch: an app defect gets a red-first jest test, and plain host slowness is escalated. The old
  "shared seed change" risk has been removed. Planner Notes now name a frontend fix as the likely outcome.
- **Round-1 non-blocking notes: taken up.** Task 3.5 records the PR's own CI result for :104 with no rerun. Task 3.4
  confirms the file has 4 tests. I counted `grep -c '^\s*test('` = 4, so 40/40 = `--repeat-each=10` holds today.

**CI evidence claims in design.md, checked against the files:**

- The persisted `ci-run45496270684-e2e8-error-context.md` is byte-identical (`cmp`) to the artifact's
  `error-context.md` under `ci-art/report8/.../hel1573-motion-grid-chart--f78c0--refresh-does-not-replay-it-dev/`.
- The snapshot matches the design's description:
  - "M-chart Primary" is `[pressed]` and is the selected tab.
  - The Table panel shows 4 rows (500/575/320/410).
  - The Metric shows `1,805`.
  - The "M-chart Chart" article has its heading, its actions, a `status` node and the provenance/"Updated 11/24/2026"
    footer, with no body content.
- `trace.zip` and `video.webm` exist at the cited path. `trace.zip` contains `1-trace.network` and `test.trace`.
- `runner8/identity.txt` says `cpu_model: AMD EPYC 7763 64-Core Processor`, `vcpus: 4`. This matches the design.
- Cited source paths exist: `ChartRenderer.tsx`, `chartPanelModule.ts`, `ChartPanel.tsx`.
- `e2e/hel1573-motion-grid-chart.spec.ts:115` is the canvas `toBeVisible` and comes right after `goto` at :114.

**My own reading of the CI trace.** I extracted it to the scratch dir `skeptic-d2-trace/`, read it with
`python3 -I`, and used monotonic ms from the trace itself. This is supporting evidence, not a substitute for task 1.3.

- The `toBeVisible` expect ran from 1165061 to 1170111 (5.05 s), then failed.
- `GET /api/dashboards/:id/panels` was requested at 1166512 (+1.45 s into the wait). The three Output, rows and
  assertion-status requests started at about 1167293 and finished by about 1168240.
- `GET /runs/latest` was requested at 1167754.
- `src/features/panels/ui/ChartPanel.tsx` was first requested at 1168073, about 3.0 s into the wait and after the
  data requests. `echartsCore.ts` and `echarts-for-react` followed at 1168484. The four `echarts_*` dep modules all
  finished by about 1168796.
- So every network request in the chart chain completed about 1.3 s before the timeout, and the canvas was still not
  visible.
- `frontend.log` shows no Vite dependency re-optimisation or reload.
- The trace is consistent with the design's narrowing: the data is present and the chart path is the pending step. It
  points toward the post-load part of that path (ECharts init or box size, or main-thread starvation) and the late,
  data-gated `ChartPanel.tsx` import, rather than a backend or seed cause. D1 and D2 already cover both.
- The trace does not contradict any statement in the design.

### Verdict: CONFIRM

The round-1 defect is fixed. The design no longer offers a no-op fix as a default path. The CI ground truth is cited
accurately, and the probe covers every step still open. The decision tree sends each possible cause to an
evidence-gated fix that can meet the mutation AC. The remaining problems are wording leftovers in the proposal and
tasks (notes below). D2 controls and is explicit, so none of them would lead a competent executor to a wrong fix.

### Non-blocking notes

- **Leftover seed framing in proposal.md.** Impact lists `motionPrimitivesSeed.ts` as "(likely)" and the frontend
  only "if the probe implicates it". It also says "No backend", while D2's first branch allows a backend fix. The CI
  evidence has already implicated the chart render path, so Impact should say that, to match design.md Planner Notes.
  ticket.md is the owner's ticket mirror, and keeping its candidate list there is correct. It is not a defect.
- **Leftover seed framing in tasks.md and design.md.**
  - tasks.md 2.1 still names "seed awaits terminal `succeeded` run" as its first example. It should say
    "per D2 (app fix with a red-first jest test is the expected branch)".
  - design.md D1's "Alternative rejected: fixing the un-awaited `/run`" and the Risks line about `expect.poll` on run
    status still describe `/run` as un-awaited. That contradicts the corrected Context.
- **Garbled hook spec.** D1 says `HEL1651_CPU_THROTTLE=<int>=1..>`. It should read "an integer ≥ 1", validated like
  the HEL1829 precedent.
- **Weak evidence label.** "No canvas in the a11y tree" proves little. Playwright's aria snapshot does not normally
  list a role-less `<canvas>`, so the snapshot cannot tell an absent canvas from one present at zero size. The design
  keeps both candidates open, which is correct. The probe (c) box-size reading is what will decide between them.
- **Shared `status` node.** The `status` node in the Chart card also appears in the Table and Metric cards. It is a
  shared card element, not a chart-specific placeholder.
- **Executor hint from the trace.** The chart chain finished about 1.3 s before the timeout, so a fix that only
  prefetches the chunk may not be enough on its own. Measure ECharts init and the canvas box size after the module
  loads.
