## Context

The test (now `e2e/support/hel1583-glass-nav.ts:549`, shared by `e2e/hel1583-glass-nav-light.spec.ts` and
`e2e/hel1583-glass-nav-dark.spec.ts`) does: open at 375px as a fresh user, set tier beta, reload, wait for
`.bottom-nav`, click "Open assistant", click the overlay's "Browse all conversations" link, `toHaveURL(/\/chat$/)`
(auto-retrying), then a ONE-SHOT `navGeometry(page)` evaluate and `expect(tabs with current !== null).toEqual([])`.

CI failure 2026-11-24 (run 45488894333, job 138781572966, dark): the URL matched `/chat`, but the snapshot showed the
Dashboards tab with `current: "page"`. Candidate mechanisms (to be decided by probe, not assumed):

- H1: React Router commits the URL (history.pushState) before the React render that updates `NavLink`'s
  `aria-current` - e.g. a navigation wrapped in `startTransition` while a lazy `/chat` route chunk or its data suspends,
  so the whole previous UI (Dashboards page and its tab) stays on screen until the chunk resolves. The URL check passes,
  the one-shot snapshot sees the old tree.
- H2: the nav's current-tab logic derives from something other than the live location (a store, a memo, a "last
  section" value) that updates later than, or independently of, the location - so even the rendered `/chat` page can
  show a Dashboards tab as current.
- H3: something else the probe finds (overlay close/route interplay, a second navigation back, etc.).

## Goals / Non-Goals

Goals: probe-confirmed root cause; red first; a fix at the root cause; 40/40 + 5/5 at 4x CPU; a mutation that turns it
red. Non-goals: changing the nav's visual design, the overlay, or any other glass-nav test; any backend change.

## Decisions

- D1 Probe before fix. Instrument (temporarily) the failing step: log, at each animation frame / MutationObserver
  callback from the "Browse all conversations" click until settle, `location.pathname`, each tab's `aria-current`, and
  whether the `/chat` page content (a stable /chat landmark) is in the DOM. Reproduce with `--repeat-each` on both theme
  specs (2 workers, `nice -n 19`), and with CDP `Emulation.setCPUThrottlingRate` 4x/6x if warm runs do not fail. The
  probe output of a failing (or slowed) run is committed as evidence.
- D2 CI artifacts: fetch the Playwright report/trace for run 45488894333 job 138781572966 and run 39830913828
  attempt 1 (per-attempt via `gh api .../runs/<id>/attempts/<n>/jobs`) into the main checkout's
  `.concertino/scratch/HEL-1701/`; record what they show (or that they are expired/absent) in `ci-artifacts.txt`. Saved
  logs are filtered with `grep -v CONNECTOR_MASTER_KEY`; no CI env block ever goes into evidence.
- D3 Product vs test. Decide from the probe:
  - If the window where a tab reads current coexists with the `/chat` page content already rendered (the user sees the
    chat page with Dashboards highlighted), it violates the mobile-bottom-nav requirement: fix in the app (make the
    current-tab state derive from the same location the rendered route uses), and keep the test's assertion.
  - If the whole UI is still the previous page (pending transition: the URL changed but the Dashboards page and its tab
    are both still what is rendered), the nav agrees with what the user sees; the test is wrong to snapshot before the
    `/chat` page renders. Fix in the test by first waiting on a real `/chat` condition (a stable /chat landmark
    visible) and only then taking the geometry snapshot and asserting no tab is current. Merely wrapping the existing
    assertion in `expect.poll`/a retrying assertion with no /chat condition is not acceptable: it would also hide a
    product lag. No timeout values may be raised and no retry added.
  - If the probe shows a third mechanism, choose by the same rule (can a real user see a wrong state?) and say so in
    `root-cause.md`.
- D4 Guard and mutation: the fixed test itself (both themes) is the guard; additionally a jest test if the fix is in the
  app. Mutation = revert the fix only, rerun under the conditions that produced red, commit the red output as `.txt`.
- D5 Green rate: 40/40 across both theme specs (`--repeat-each` sized so the two-taps test runs 40 times total, 2
  workers, `nice -n 19`), plus 5/5 at 4x CPU throttling. If the red rate p under the red conditions is low, also run
  N >= ceil(3/p) under those same conditions after the fix and state the arithmetic.
- D6 Scope: touch only the test helper and, if D3 says so, the minimal app files. Do not touch HEL-1651's files
  (chart-chunk preload in the dashboard load path, hel1573/hel1584 specs) or HEL-1852's backend files.

## Risks / Trade-offs

- The race may not reproduce locally warm; throttling (D1) is the planned lever. If neither reproduces it after a
  bounded effort, the executor escalates with the probe data rather than guessing a fix.
- An app fix in route loading could affect other routes' transitions; the full glass-nav spec files and the frontend
  unit suite are re-run.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file or script invoked by `.husky/pre-commit` is touched.
