## Context

See proposal.md (Why). The failing wait is `e2e/hel1573-motion-grid-chart.spec.ts:115`:
`expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible()` (Playwright default 5 s), directly after
`seedWorld(request, "M-chart")` and `page.goto("/dashboards")`. `seedWorld` (`e2e/support/motionPrimitivesSeed.ts:15`) awaits
its `/run` POST (:50), and `POST /run` answers only after the run is terminal and `node_snapshots` are written
(`PipelineRunSubmitRoutes.scala:23-31`, `ServiceResponse.scala:34-40` `onSuccess`, `PipelineRunExecutor.scala:413,473-487`,
`PipelineRunSucceededWrites.scala:85-108`), so the seed does not race the run (design-gate round 1, CR1).
**CI evidence at the failure** (run 45496270684 e2e (8), `error-context.md` persisted to
`.concertino/runs/HEL-1651/evidence/`; trace.zip and video under
`.concertino/scratch/HEL-1651/ci-art/report8/.../hel1573-motion-grid-chart--f78c0--refresh-does-not-replay-it-dev/`):
the seeded Primary dashboard WAS open, the Table panel showed all 4 rows and the Metric showed `1,805`, and the Chart
card showed its header, provenance and "Updated" footer with an empty body (only a `status` node: no canvas in the
a11y tree, no empty-state text). So the data was there; the chart-specific render path is the pending step. Candidates
left: the lazy chart chunk / Suspense fallback (`ChartRenderer.tsx`, `chartPanelModule.ts`, HEL-512/HEL-1760), the
chart's own data/aggregate request, or a canvas present at zero size (Playwright `toBeVisible` is false for an empty
box — HEL-1647). The CPU on that runner was AMD EPYC 7763, 4 vCPU (`identity.txt`). Precedent for env-gated CDP throttling:
`HEL1829_CPU_THROTTLE` in `e2e/hel1572-appearance-preferences.spec.ts:~150` (`Emulation.setCPUThrottlingRate`).
HEL-1658 saw this exact wait fail 10/10 at CDP 6x. `seedWorld` has 7 other callers (hel1584, hel1657, hel1738,
hel1656, hel1681, hel1746, support/hel1573-motion-primitives.ts).

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause; a state-based fix at that cause; the AC's red / 40-of-40 / 5-of-5-at-4x /
mutation evidence. **Non-Goals:** HEL-1647 unless proven to be the cause; other flakes with a different cause;
any change to the 5 s default, retries, or the assertion's strength.

## Decisions

**D1 — Probe before fixing (systematic-debugging law).** Add an env-gated CPU throttle to this spec, following the
HEL1829 precedent: `HEL1651_CPU_THROTTLE` (an integer >= 1, validated like HEL1829; invalid throws) applies `Emulation.setCPUThrottlingRate` on the page before
`goto`; unset = no CDP session, no behavior change. Reproduce at 4x and 6x. The probe records, at the moment the 5 s
lapses, each candidate's state: (a) the pipeline run's status at `goto` time and at timeout (via the run status API
from `request`) — a confirmation of the code reading only: record the `/run` response (status, `runId`) and
`GET /runs/latest` right after seedWorld; a non-terminal run after a 2xx would be an app defect to explain, never a
reason to add a poll; (b) whether the chart chunk request (`chartPanelModule`/echarts chunk) had completed (network log);
(c) whether `.chart-panel__canvas` exists and its box size (zero-size init, HEL-1647); (d) what the chart card shows
instead (empty state / skeleton / error text); (e) the CPU model of the local host. Also record, relative to `goto`, the start/end of every request in the
first-render chain (session → dashboards list → which dashboard opens → `GET /api/dashboards/:id/panels` → the chart's
rows/aggregate request → the chart chunk → ECharts init and canvas box size) and which are pending or unrequested when
5 s lapses. Read the CI trace.zip (network + DOM snapshots + console) FIRST: it is the ground truth for the CI failure. Fetch the failing CI job's trace/video artifact if uploaded and read the network
and DOM at failure. Evidence goes to `openspec/changes/first-chart-render-wait/` (probe results + red run as `.txt`).
Alternative rejected: adding a run-status poll to the seed — `/run` is already awaited to a terminal run, so it would be a no-op.

**D2 — The fix follows the proven cause (decision tree, fixed now so the executor does not improvise):**
- Run not terminal after a 2xx `/run` (contradicts the code reading; NOT the default) → explain it as an app defect
  and fix the backend at its cause with a red-first test; only then consider the seed.
- A data request (panels / chart rows / aggregate) is the pending step → if it is an app defect (serialised or
  duplicated fetches, a request gated on a later event, a chart-only fetch that the table/metric do not need), fix the
  app with a red-first jest test; if it is plain host slowness with correct behaviour, escalate with measurements.
- Chunk load / app first-render is the slow step and the app misbehaves (e.g. the canvas never appears until a later
  status poll, or ECharts inits at zero size and never resizes) → fix the app in the chart render path with a jest
  unit test that is red first; escalate if the fix is a product-behavior change the ticket does not settle.
- Purely host slowness with every step progressing correctly and no app defect → do NOT raise the timeout; escalate
  with the measurements (this is a product question the ticket does not settle).
- More than one cause contributes → fix each proven one by its branch above.

**D3 — Red-first protocol.** The red run is the unchanged spec at the throttle rate that reproduces (4x preferred;
6x if 4x does not), committed as `.txt` before any fix code. The mutation is reverting only the fix (the throttle
hook stays), re-run at the same rate, recorded red. Green: full spec file 40/40 unthrottled (`--repeat-each=10`
over 4 tests, 2 workers, `nice -n 19`) and the chart test 5/5 at 4x.

**D4 — Sibling assessment.** For each spec with `.chart-panel__canvas canvas` waits or a `seedWorld` call
(hel1584-motion-surfaces :107/:505, hel1573-motion-grid-chart :405, support/hel1573-motion-primitives.ts:64,
hel572, hel588, hel1392, hel1780), state in the PR whether the proven cause applies. An app-level fix covers every
chart surface automatically; a spec-level fix is applied elsewhere only if cause and fix are identical, else listed.

## Risks / Trade-offs

- [The throttle hook could leak into normal runs] → strictly env-gated, validated integer, no CDP session when unset.
- [Local repro may not reproduce CI's cause] → cross-check with the failing CI job's trace/video; if the CI evidence
  disagrees with the local repro, the CI evidence wins and the disagreement is reported.
- [An app fix in the chart render path touches every chart] → red-first jest test plus the full chart e2e specs
  (hel572, hel588, hel1392, hel1780) run once; escalate if the fix changes product behaviour the ticket does not settle.

## Planner Notes

- Self-approved: scope follows the proven cause (the CI evidence points at the chart render path, so a frontend
  fix is the likely outcome; no backend unless the probe contradicts the run-terminal reading), `skip_specs: true`, the env-gated throttle hook (HEL1829 precedent).
- Lane constraints (C1-C14 from the driver brief) are restated to every sub-agent; lane DB `helio_hel1651`.

## Implemented outcome (HEL-1651, as built)

**D2 outcome.** The probe landed in the "host slowness, correct behaviour" branch (evidence/probe-findings.md): every step
of the first-render waterfall progresses correctly, and the first canvas sits at the end of a ~7-hop serial chain
(boot, auth, dashboards, panels, Output metadata, chart chunk, echarts deps, ECharts init). It was escalated, not decided.

**Owner rulings.** C1 (`preload-chart-chunk-earlier`): try an early, low-priority chart preload. C2
(`preload-plus-state-wait`): keep it and add a test-side state wait. C3
(`drop-preload-ship-state-wait+fix-172-273-in-pr`): drop the preload (C1 retired), ship the state wait, fix the two
post-canvas flakes in this PR.

**The preload was tried and dropped; nothing of it ships.** An idle chart-chunk preload (first on mount, then after the
first panel data committed) was measured on the production build and in dev: started on mount it delayed the first Table
cell by ~225 ms and the Metric by ~222 ms at 6x on production (+730 / +900 ms in dev) with no canvas gain; started after
the first data it delayed nothing and gained nothing measurable, at ~224 kB gzip per table-only dashboard. `frontend/src`
is identical to origin/main; HEL-1760's Output-metadata preload is unchanged.

**The state wait.** `e2e/hel1573-motion-grid-chart.spec.ts` (chart test) waits, after `goto("/dashboards")`, for the seeded
Table cell `500` to be visible with a 15 s ceiling (the `waitForPanelGrid` helper's own), then asserts the canvas with the
unchanged 5 s default. No retry, no raised canvas timeout. `HEL1651_CPU_THROTTLE` (`e2e/support/cpuThrottle.ts`) is the
env-gated CDP throttle used to reproduce (unset = no CDP session).

**The `:273` flake.** "bars do not grow from zero after a type change" sampled a frame from BEFORE zrender repainted the
replayed option (the recorder's animation-frame tick ran ahead of the repaint and still saw the line render, sum 36 of
293), so the bar ratio was 36/293 = 0.124 on a slow host. The assertion now counts only frames from the first one that
differs from the pre-`setOption` frame, and a new assertion requires at least one such painted frame. The bound (0.9) is
unchanged; what changed is which frames are the replay's: a genuine replay still fails it (mutation: carrying
`animationDuration: 280` gives 0.13).

**The `:172` flake.** Not reproduced once the preload was dropped (0 failures in ~150 chart-test runs at 4x, 6x and 10x);
all sightings (148.4, 131.7, 59.8) were in runs with an early preload present. No fix was made without a reproduction;
see probe-findings.md.

**Siblings.** hel1573 :405 and hel1584 :107/:505 already wait on `waitForPanelGrid` (live grid reaches N items, then the
skeleton unmounts: a page-state wait with a 15 s ceiling), so they are unchanged apart from the env-gated throttle hook.
