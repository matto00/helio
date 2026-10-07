## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (untracked, on HEAD 77bdaec8eacd775b3d85b8793016cdd0a6f24b0c).
Cross-checked against the tree (both specs, `RecentVisitsRouteObserver.tsx`, `recentVisitsListeners.ts`,
`useRecentPaletteActions.ts`, `AppRoutes.tsx`, `playwright.config.ts`) and the CI artifacts in the session
scratchpad (`ci/job-*.log`, `ci/r*-s3`, `ci/r*-s4`, extracted traces). I parsed the traces myself
(`scratchpad/skeptic/steps.py`: top-level `before`/`after` events in `test.trace`).

### What I verified (with evidence)

- **Failures are real and reproduce across two runs.** `job-112015684330.log` (4 workers, shard 3) and
  `job-112023489468.log` (3 workers, shard 3): hel519 `:90` fails `toBeVisible` at `:100` (branch numbering = main
  `:94`). `job-112015684487.log` (4w) and `job-112023489455.log` (3w): hel910 `:90` hits "Test timeout of 30000ms".
  No retries appear in the logs.
- **hel519 snapshot claim: confirmed.** In both `error-context.md` files the route is `/pipelines` (breadcrumb "Data
  Pipelines"), the palette is open, and its groups are only Navigation, General and Create. There is no Recent group.
- **hel519 timeline supports the leading hypothesis.** Traces t519r1/t519r2: the list-row click ends, then
  `Wait for load state` takes 0.00s (the `waitForURL` resolves at once), and the sidebar "Data Pipelines" click
  starts in the same millisecond. In both traces' network logs no request between the row click and `/api/pipelines`
  is specific to the detail page. This is consistent with the detail route never committing. It does not prove it,
  because I did not confirm that `SourceDetailPage` fetches anything by id, so the design's probe is still needed.
  `SourceDetailPage` is not lazy (`AppRoutes.tsx:113`). The recorder is a post-commit `useEffect` on
  `location.pathname` (`RecentVisitsRouteObserver.tsx:42-56`), so "the URL changed but nothing committed" means
  nothing is recorded. The claim matches the code.
- **hel910 per-step claims: broadly confirmed.** No single step stalls. The largest steps are `goto` 1.8–2.97s, the
  "Outputs" tab click 1.47/2.56s, the "New pipeline" click 0.94/2.07s, and the post-`/` heading wait 1.59/1.64s. Login
  overhead (register through `waitForURL("/")`) is 4.2s / 5.5s. The `goto("/")` plus heading costs 3.4s / 4.1s. The
  run-2 (4w) trace's terminal error is the "Dashboard actions" click (`:188`), which matches `job-112015684487.log`.
- **Default budgets.** `playwright.config.ts` sets no `timeout`, so the per-test default of 30s applies. CI's own
  failure text confirms it.
- **Scope and constraints.** The plan touches only the two specs, plus `commandPalette/**` on D2's product branch.
  It does not touch `playwright.config.ts` or `ci.yml`, introduces no quarantine, keeps the assertions and the `io`
  count unchanged, and has no timeout-only fix. D3 explicitly forbids `test.setTimeout`/`test.slow()` as the fix.
  This matches the owner and driver constraints.

### Verdict: REFUTE

The diagnosis is sound. The plan has two gaps that could let this ticket "pass" its ≥20-greens AC without proving
robustness. That is the evidence-shaped non-evidence this gate exists to stop.

### Change Requests

1. **D1 / tasks 1.2, 1.3, 4.1: the ≥20-greens configuration must be shown to produce red on the unchanged spec.**
   As written, task 4.1 runs the greens in "the same configuration as 1.2". 1.2 is host contention at the driver
   caps: 2 Playwright workers and at most 3 niced burners on a 6c/12t host. The CI failures happened at 3–4 workers
   on a 4-vCPU runner that also carried vite, the backend and postgres. Nothing in the plan guarantees that 1.2 ever
   goes red, and 20 greens under a configuration that never fails proves nothing. Revise D1 and tasks so that:
   - (a) The configuration used for 4.1 is the one under which the unchanged spec produced a measured, non-zero
     failure rate (recorded in 1.2/1.3), per spec.
   - (b) If host contention within the driver caps gives 0 reds, the CDP `Emulation.setCPUThrottlingRate` method is
     calibrated, by rate, until the unchanged spec reproduces the CI failure mode. The same rate is then applied to the
     fixed spec for the ≥20 greens. The design must say how the throttle is applied to the fixed spec without being
     committed, for example an uncommitted wrapper or fixture removed before commit and recorded in
     `files-modified.md`.
   - (c) If no permitted configuration reproduces a spec's failure, the executor escalates with the numbers. It must
     not claim the AC.
2. **D3: put the margin arithmetic in, and add an acceptance signal beyond "green".** Projecting the cited traces
   forward from their timeout point:
   - Run 1 (3w) needs about 31.7s to finish. Run 1 had the last option click in flight at timeout; add the picker
     hide (~0.8s) and the grid count (~0.5s).
   - Run 2 (4w) needs about 37–38s. Run 2 still had two Dashboard-actions → menuitem → option → hide cycles left,
     at about 2.8s each per run 1's measured cycles.
   - D3's proposed saving is API login instead of UI login, about 4–5s net. That gives about 27s in run 1 (~8%
     headroom) and about 33s in run 2, which still fails.

   So the planned fix, by the design's own evidence, barely clears the 3-worker level and cannot clear the 4-worker
   level. Revise D3 to:
   - (a) State these projections explicitly.
   - (b) Name the per-step costs that dominate under contention (Outputs tab click 1.5–2.6s, "New pipeline" click
     0.9–2.1s, option click 1.1–1.5s, `/` heading 1.6s) as product-slowness candidates to measure idle vs. contended
     before concluding "overhead only".
   - (c) Require tasks 4.1 and 4.2 to record each green run's wall-clock duration, report the max/p95 against the 30s
     budget, and pre-state the headroom that counts as "robust" rather than "green this time". A max within about 10%
     of 30s is a flake waiting to happen and should go to escalation, not delivery.
3. **D2: the decision tree is not exhaustive. Add the missing branches and a catch-all.** The two branches cover
   (not rendered, no entry) and (rendered, entry missing). The instrumentation can also show:
   - (i) an entry present in `localStorage` while the palette renders no Recent group. This is real code:
     `useRecentPaletteActions.ts:63-64` skips any entry whose title resolves to `null`, and an entry can be recorded
     untitled (`recordVisit(..., undefined)`) when `sources.items` has not loaded at commit.
   - (ii) a detail view that rendered with no entry recorded.

   Each is a product defect, not a test defect, and must route to the product branch (Jest red-without-fix plus a
   delta spec). Add: "any outcome outside the enumerated branches → keep probing; do not force-fit a branch".
4. **tasks.md: fill in the empty `## Standing Constraints` section.** List the binding driver/owner constraints so the
   executor reads them at point of use:
   - at most 2 Playwright workers under `nice -n 19`, and at most 3 niced burners killed only by recorded PID
   - at most one CI run at a time
   - no edits to `playwright.config.ts` or `ci.yml`
   - no quarantine, no loosened assertions, no timeout increase
   - exact ids/emails of every dev-DB row created; never delete by pattern
   - this lane owns all edits to both spec files; HEL-1300 does not edit them

### Non-blocking notes

- design.md's "29.8s (run 1, last option click) and 29.2s (run 2, first option click)" does not match my parse
  exactly. I get the in-flight step starting at 29.13s and 29.48s from the first trace event, and run 2's terminal
  error is the "Dashboard actions" click. The conclusion is unaffected, but correct the figures or state the time
  origin used.
- The "full reload auto-selected dashboard" verdict in D4 is reasonable to record as a follow-up rather than fix, as
  planned.
- The task 1.1 dev-server cwd check is good. Keep the evidence of it.
